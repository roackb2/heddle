import { BedrockAgentCoreClient } from '@aws-sdk/client-bedrock-agentcore';
import {
  createServer,
  type IncomingMessage,
  type RequestListener,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AGENTCORE_RUNTIME_SESSION_HEADER,
  EXECUTION_ASSERTION_HEADER,
  EXECUTION_HOST_LOCAL_TOKEN_HEADER,
  MCP_CAPABILITY_HEADER,
  MODEL_API_KEY_HEADER,
  type ExecutionHostHeartbeatStreamEvent,
  type ExecutionHostStreamEvent,
} from '../contracts/index.js';
import {
  ExecutionHostInvocationCancelledError,
  ExecutionHostStreamInterruptedError,
  type ExecutionHostConversationTurn,
  type ExecutionHostHeartbeatTask,
} from '../http-sse/index.js';
import { AgentCoreExecutionHost } from './agentcore-execution-host.js';
import type { AgentCoreRuntimeClient } from './types.js';

const RUNTIME_ARN =
  'arn:aws:bedrock-agentcore:us-east-2:123456789012:runtime/example_runtime';
const servers = new Set<ReturnType<typeof createServer>>();

afterEach(async () => {
  await Promise.all([...servers].map((server) => new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  })));
  servers.clear();
});

describe('AgentCoreExecutionHost', () => {
  it.each([
    ['region', { region: 'US East 2' }],
    ['Runtime ARN', { runtimeArn: 'arn:aws:lambda:us-east-2:123:function:x' }],
    ['qualifier', { qualifier: 'invalid qualifier' }],
  ])('rejects an invalid %s at composition', (_label, override) => {
    expect(() => new AgentCoreExecutionHost({
      region: 'us-east-2',
      runtimeArn: RUNTIME_ARN,
      qualifier: 'pilot',
      client: { send: vi.fn<AgentCoreRuntimeClient['send']>() },
      ...override,
    })).toThrow();
  });

  it('signs and streams the portable Execution Host contract through the AWS SDK', async () => {
    const observed = {
      headers: {} as IncomingMessage['headers'],
      body: '',
    };
    const origin = await listen(async (request, response) => {
      observed.headers = request.headers;
      observed.body = await readBody(request);
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        [AGENTCORE_RUNTIME_SESSION_HEADER]: input().runtimeSessionId,
      });
      response.end(toSse([accepted(), result()]));
    });
    const client = new BedrockAgentCoreClient({
      region: 'us-east-2',
      endpoint: origin.toString(),
      credentials: {
        accessKeyId: 'test-access-key',
        secretAccessKey: 'test-secret-key',
      },
      maxAttempts: 1,
    });
    const host = new AgentCoreExecutionHost({
      region: 'us-east-2',
      runtimeArn: RUNTIME_ARN,
      qualifier: 'pilot',
      client,
    });

    const events = await collect(host.streamConversationTurn(input()));

    expect(events.map(({ kind }) => kind)).toEqual(['accepted', 'result']);
    expect(observed.headers[EXECUTION_ASSERTION_HEADER])
      .toBe(input().executionAssertion);
    expect(observed.headers[MCP_CAPABILITY_HEADER]).toBe(input().mcpCapability);
    expect(observed.headers[MODEL_API_KEY_HEADER]).toBe(input().modelApiKey);
    expect(observed.headers[AGENTCORE_RUNTIME_SESSION_HEADER])
      .toBe(input().runtimeSessionId);
    expect(observed.headers[EXECUTION_HOST_LOCAL_TOKEN_HEADER]).toBeUndefined();
    expect(observed.headers.authorization).toContain('AWS4-HMAC-SHA256');
    expect(observed.headers.authorization).toContain(
      EXECUTION_ASSERTION_HEADER,
    );
    expect(observed.headers.authorization).toContain(MCP_CAPABILITY_HEADER);
    expect(observed.headers.authorization).toContain(MODEL_API_KEY_HEADER);
    expect(JSON.parse(observed.body)).toEqual({
      schemaVersion: 1,
      kind: 'conversation-turn',
      invocationId: input().invocationId,
      prompt: input().prompt,
    });

    host.close();
  });

  it('keeps a clean EOF without a terminal event interrupted', async () => {
    const origin = await listen(async (_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end(toSse([accepted()]));
    });
    const client = new BedrockAgentCoreClient({
      region: 'us-east-2',
      endpoint: origin.toString(),
      credentials: {
        accessKeyId: 'test-access-key',
        secretAccessKey: 'test-secret-key',
      },
      maxAttempts: 1,
    });
    const host = new AgentCoreExecutionHost({
      region: 'us-east-2',
      runtimeArn: RUNTIME_ARN,
      client,
    });

    await expect(collect(host.streamConversationTurn(input())))
      .rejects.toBeInstanceOf(ExecutionHostStreamInterruptedError);

    host.close();
  });

  it('invokes the explicit heartbeat workflow through AgentCore', async () => {
    let requestBody: unknown;
    const origin = await listen(async (request, response) => {
      requestBody = JSON.parse(await readBody(request));
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end(toSse([heartbeatAccepted(), heartbeatResult()]));
    });
    const host = new AgentCoreExecutionHost({
      region: 'us-east-2',
      runtimeArn: RUNTIME_ARN,
      client: new BedrockAgentCoreClient({
        region: 'us-east-2',
        endpoint: origin.toString(),
        credentials: {
          accessKeyId: 'test-access-key',
          secretAccessKey: 'test-secret-key',
        },
        maxAttempts: 1,
      }),
    });

    const events = await collect(host.streamHeartbeatTask(heartbeatInput()));

    expect(requestBody).toMatchObject({
      schemaVersion: 1,
      kind: 'heartbeat-task',
      invocationId: heartbeatInput().invocationId,
      taskId: heartbeatInput().taskId,
    });
    expect(events.map(({ kind }) => kind)).toEqual(['accepted', 'result']);
    host.close();
  });

  it('propagates caller cancellation into the AWS invocation', async () => {
    const client: AgentCoreRuntimeClient = {
      send: async (_command, options) => await new Promise((_resolve, reject) => {
        options?.abortSignal?.addEventListener('abort', () => {
          reject(new DOMException('cancelled', 'AbortError'));
        }, { once: true });
      }),
    };
    const host = new AgentCoreExecutionHost({
      region: 'us-east-2',
      runtimeArn: RUNTIME_ARN,
      client,
    });
    const controller = new AbortController();

    const running = collect(host.streamConversationTurn(input({
      signal: controller.signal,
    })));
    controller.abort();

    await expect(running).rejects.toBeInstanceOf(
      ExecutionHostInvocationCancelledError,
    );
  });

  it('rejects a provider-incompatible session ID before calling AWS', () => {
    const send = vi.fn<AgentCoreRuntimeClient['send']>();
    const host = new AgentCoreExecutionHost({
      region: 'us-east-2',
      runtimeArn: RUNTIME_ARN,
      client: { send },
    });

    expect(() => host.streamConversationTurn(input({
      runtimeSessionId: `runtime-session:${'a'.repeat(40)}`,
    }))).toThrow('AgentCore runtime session ID is not provider-compatible.');
    expect(send).not.toHaveBeenCalled();
  });
});

async function listen(
  handler: RequestListener,
): Promise<URL> {
  const server = createServer(handler);
  servers.add(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;
  return new URL(`http://127.0.0.1:${address.port}`);
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function input(
  overrides: Partial<ExecutionHostConversationTurn> = {},
): ExecutionHostConversationTurn {
  return {
    invocationId: 'invocation_agentcore_test',
    runtimeSessionId: 'runtime-session-agentcore-test-000000000001',
    prompt: 'Read the workspace and summarize it.',
    executionAssertion: 'execution-assertion-value'.padEnd(48, 'x'),
    mcpCapability: 'mcp-capability-value'.padEnd(48, 'x'),
    modelApiKey: 'model-api-key-value',
    ...overrides,
  };
}

function accepted(): ExecutionHostStreamEvent {
  return {
    schemaVersion: 1,
    invocationId: input().invocationId,
    runId: 'run_agentcore_test',
    timestamp: '2026-08-11T00:00:00.000Z',
    sequence: 0,
    kind: 'accepted',
  };
}

function result(): ExecutionHostStreamEvent {
  return {
    schemaVersion: 1,
    invocationId: input().invocationId,
    runId: 'run_agentcore_test',
    timestamp: '2026-08-11T00:00:01.000Z',
    sequence: 1,
    kind: 'result',
    result: { outcome: 'done', summary: 'Complete.' },
  };
}

function heartbeatInput(): ExecutionHostHeartbeatTask {
  return {
    invocationId: 'heartbeat_agentcore_test',
    runtimeSessionId: input().runtimeSessionId,
    taskId: 'heartbeat-task-001',
    task: 'Review the workspace.',
    runContext: {
      currentDateTime: '2026-08-18T00:00:00.000Z',
      intervalMs: 60_000,
    },
    executionAssertion: input().executionAssertion,
    modelApiKey: input().modelApiKey,
  };
}

function heartbeatAccepted(): ExecutionHostHeartbeatStreamEvent {
  return {
    schemaVersion: 1,
    invocationId: heartbeatInput().invocationId,
    runId: 'heartbeat-run-001',
    timestamp: '2026-08-18T00:00:00.000Z',
    sequence: 0,
    kind: 'accepted',
  };
}

function heartbeatResult(): ExecutionHostHeartbeatStreamEvent {
  return {
    schemaVersion: 1,
    invocationId: heartbeatInput().invocationId,
    runId: 'heartbeat-run-001',
    timestamp: '2026-08-18T00:00:01.000Z',
    sequence: 1,
    kind: 'result',
    result: { decision: 'continue', summary: 'Complete.' },
  };
}

type StreamEvent = ExecutionHostStreamEvent | ExecutionHostHeartbeatStreamEvent;

function toSse(events: StreamEvent[]): string {
  return events.map((event) => [
    `event: ${event.kind}`,
    `id: ${event.sequence}`,
    `data: ${JSON.stringify(event)}`,
    '',
    '',
  ].join('\n')).join('');
}

async function collect(
  events: AsyncIterable<StreamEvent>,
): Promise<StreamEvent[]> {
  const collected: StreamEvent[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
}
