import { describe, expect, it, vi } from 'vitest';
import type { ExecutionAuthority } from '../authority/index.js';
import {
  EXECUTION_CONTRACT_VERSION,
  HEARTBEAT_TASK_WORKFLOW,
  type ExecutionHostHeartbeatStreamEvent,
} from '../contracts/index.js';
import {
  HostedHeartbeatAgentExecutionTransport,
  HostedHeartbeatTaskService,
  type HostedHeartbeatTaskInput,
} from '../heartbeat/index.js';
import {
  DirectHttpExecutionHost,
  type HeartbeatExecutionHost,
} from '../http-sse/index.js';

const NOW = '2026-08-18T04:00:00.000Z';
const RUNTIME_SESSION_ID = `runtime-session-${'a'.repeat(40)}`;

describe('hosted heartbeat execution', () => {
  it('binds authority and credentials while returning activity and the terminal result', async () => {
    const issue = vi.fn<ExecutionAuthority['issue']>(async (authority) => {
      const metadata = {
        scope: { adopterId: 'adopter-a', ...authority.scope },
        runtimeSessionId: authority.runtimeSessionId,
        invocationId: authority.invocationId,
        workflow: authority.workflow,
        issuedAt: NOW,
        executionExpiresAt: '2026-08-18T04:05:00.000Z',
      } as const;
      return {
        metadata,
        executionAssertion: () => 'execution-assertion-value'.repeat(2),
        mcpCapability: () => undefined,
        toJSON: () => metadata,
      };
    });
    let hostInput: Parameters<HeartbeatExecutionHost['streamHeartbeatTask']>[0]
      | undefined;
    const result = { decision: 'continue', summary: 'Complete.' };
    const executionHost: HeartbeatExecutionHost = {
      streamHeartbeatTask: async function* (input) {
        hostInput = input;
        yield event(0, { kind: 'accepted' });
        yield event(1, { kind: 'activity', activity: { type: 'progress' } });
        yield event(2, { kind: 'result', result });
      },
    };
    const service = new HostedHeartbeatTaskService({
      authority: { issue, publicJwks: () => ({ keys: [] }) },
      executionHost,
      modelCredentials: {
        resolveModelApiKey: async () => 'model-api-key-value',
      },
    });
    const activities: unknown[] = [];

    await expect(service.execute(input({
      publishActivity: (activity) => {
        activities.push(activity);
      },
    }))).resolves.toEqual(result);

    expect(issue).toHaveBeenCalledWith(expect.objectContaining({
      workflow: HEARTBEAT_TASK_WORKFLOW,
      invocationId: 'execution-001',
    }));
    expect(hostInput).toMatchObject({
      invocationId: 'execution-001',
      taskId: 'task-001',
      task: 'Review the workspace.',
      executionAssertion: expect.stringContaining('execution-assertion'),
      modelApiKey: 'model-api-key-value',
    });
    expect(activities).toEqual([{ type: 'progress' }]);
  });

  it('binds the scheduler execution id and leaves only scope/session resolution to the product', async () => {
    let received: HostedHeartbeatTaskInput | undefined;
    const transport = new HostedHeartbeatAgentExecutionTransport({
      runner: {
        execute: async (request) => {
          received = request;
          return { ok: true };
        },
      },
      resolveInvocationContext: async ({ taskId, executionId }) => {
        expect({ taskId, executionId }).toEqual({
          taskId: 'task-001',
          executionId: 'execution-001',
        });
        return {
          scope: {
            tenantId: 'tenant-a',
            subjectId: 'subject-a',
            productSessionId: 'product-session-a',
          },
          runtimeSessionId: RUNTIME_SESSION_ID,
          deadlineAt: '2026-08-18T04:10:00.000Z',
        };
      },
    });
    const publishActivity = vi.fn();

    await expect(transport.execute({
      request: {
        executionId: 'execution-001',
        taskId: 'task-001',
        task: 'Review the workspace.',
        runContext: {
          currentDateTime: NOW,
          intervalMs: 60_000,
        },
      },
      signal: new AbortController().signal,
      publishActivity,
    })).resolves.toEqual({ ok: true });

    expect(received).toMatchObject({
      invocationId: 'execution-001',
      taskId: 'task-001',
      runtimeSessionId: RUNTIME_SESSION_ID,
      deadlineAt: '2026-08-18T04:10:00.000Z',
      publishActivity,
    });
  });

  it('uses the same strict ordered SSE protocol for direct heartbeat execution', async () => {
    let requestBody: unknown;
    const host = new DirectHttpExecutionHost({
      baseUrl: new URL('http://127.0.0.1:3000/'),
      localToken: 'local-token-value',
      fetch: async (_url, init) => {
        requestBody = JSON.parse(String(init?.body));
        return new Response(toSse([
          event(0, { kind: 'accepted' }),
          event(1, { kind: 'result', result: { decision: 'complete' } }),
        ]), {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        });
      },
    });

    const events: ExecutionHostHeartbeatStreamEvent[] = [];
    for await (const streamEvent of host.streamHeartbeatTask({
      invocationId: 'execution-001',
      runtimeSessionId: RUNTIME_SESSION_ID,
      taskId: 'task-001',
      task: 'Review the workspace.',
      runContext: {
        currentDateTime: NOW,
        intervalMs: 60_000,
      },
      executionAssertion: 'execution-assertion-value'.repeat(2),
      modelApiKey: 'model-api-key-value',
    })) {
      events.push(streamEvent);
    }

    expect(requestBody).toMatchObject({
      schemaVersion: EXECUTION_CONTRACT_VERSION,
      kind: HEARTBEAT_TASK_WORKFLOW,
      invocationId: 'execution-001',
      taskId: 'task-001',
    });
    expect(events.map(({ kind }) => kind)).toEqual(['accepted', 'result']);
  });
});

function input(
  overrides: Partial<HostedHeartbeatTaskInput> = {},
): HostedHeartbeatTaskInput {
  return {
    scope: {
      tenantId: 'tenant-a',
      subjectId: 'subject-a',
      productSessionId: 'product-session-a',
    },
    runtimeSessionId: RUNTIME_SESSION_ID,
    invocationId: 'execution-001',
    taskId: 'task-001',
    task: 'Review the workspace.',
    runContext: {
      currentDateTime: NOW,
      intervalMs: 60_000,
    },
    ...overrides,
  };
}

function event(
  sequence: number,
  body: Record<string, unknown>,
): ExecutionHostHeartbeatStreamEvent {
  return {
    schemaVersion: EXECUTION_CONTRACT_VERSION,
    invocationId: 'execution-001',
    runId: 'run-001',
    sequence,
    timestamp: NOW,
    ...body,
  } as ExecutionHostHeartbeatStreamEvent;
}

function toSse(events: ExecutionHostHeartbeatStreamEvent[]): string {
  return events.map((streamEvent) => [
    `id: ${streamEvent.sequence}`,
    `event: ${streamEvent.kind}`,
    `data: ${JSON.stringify(streamEvent)}`,
    '',
    '',
  ].join('\n')).join('\n');
}
