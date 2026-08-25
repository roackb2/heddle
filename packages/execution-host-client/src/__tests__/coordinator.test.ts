import { describe, expect, it, vi } from 'vitest';
import type {
  ExecutionAuthorityIssueInput,
  IssuedExecutionAuthority,
} from '../authority/index.js';
import {
  HostedHeartbeatCoordinatorClient,
  HostedHeartbeatCoordinatorRequestError,
  HostedHeartbeatDelegationService,
  HostedHeartbeatTaskReconciler,
  type HostedHeartbeatCoordinatorTaskView,
} from '../coordinator/index.js';

const API_TOKEN = 'coordinator-api-token-at-least-32-characters';

describe('HostedHeartbeatCoordinatorClient', () => {
  it('owns authenticated task API requests and validates the response', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (request, init) => {
      expect(String(request)).toBe('http://127.0.0.1:18082/v1/heartbeat/tasks');
      expect(new Headers(init?.headers).get('authorization')).toBe(
        `Bearer ${API_TOKEN}`,
      );
      return new Response(JSON.stringify({
        tasks: [coordinatorTask()],
      }), { status: 200 });
    });
    const client = new HostedHeartbeatCoordinatorClient({
      baseUrl: new URL('http://127.0.0.1:18082'),
      apiToken: API_TOKEN,
      fetch,
    });

    await expect(client.listTasks()).resolves.toEqual([
      coordinatorTask(),
    ]);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('owns task inspection, triggering, and coordinator admission requests', async () => {
    const requests: string[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>(async (request, init) => {
      const path = new URL(String(request)).pathname;
      requests.push(`${init?.method ?? 'GET'} ${path}`);
      if (path === '/v1/coordinator') {
        return Response.json({ state: 'running' });
      }
      if (path.endsWith('/trigger')) {
        return Response.json(coordinatorTask());
      }
      if (path.endsWith('/task-1')) {
        return Response.json({ task: coordinatorTask(), runs: [] });
      }
      return Response.json({ state: 'drained' });
    });
    const client = new HostedHeartbeatCoordinatorClient({
      baseUrl: new URL('http://127.0.0.1:18082'),
      apiToken: API_TOKEN,
      fetch,
    });

    await expect(client.readState()).resolves.toBe('running');
    await expect(client.readTask('task-1')).resolves.toEqual({
      task: coordinatorTask(),
      runs: [],
    });
    await expect(client.triggerTask('task-1')).resolves.toEqual(
      coordinatorTask(),
    );
    await expect(client.drain()).resolves.toBeUndefined();
    expect(requests).toEqual([
      'GET /v1/coordinator',
      'GET /v1/heartbeat/tasks/task-1',
      'POST /v1/heartbeat/tasks/task-1/trigger',
      'POST /v1/control/drain',
    ]);
  });

  it('reports a safe method, path, and status for rejected requests', async () => {
    const client = new HostedHeartbeatCoordinatorClient({
      baseUrl: new URL('http://127.0.0.1:18082'),
      apiToken: API_TOKEN,
      fetch: async () => new Response('secret details', { status: 403 }),
    });

    await expect(client.pause()).rejects.toEqual(
      new HostedHeartbeatCoordinatorRequestError(
        'POST',
        '/v1/control/pause',
        403,
      ),
    );
  });
});

describe('HostedHeartbeatTaskReconciler', () => {
  it('keeps admission paused until stale tasks are deleted and desired tasks persist', async () => {
    const events: string[] = [];
    const reconciler = new HostedHeartbeatTaskReconciler({
      coordinator: {
        pause: async () => { events.push('pause'); },
        listTasks: async () => {
          events.push('list');
          return [
            coordinatorTask({
              id: 'retired-task',
              taskId: 'retired-task',
            }),
            coordinatorTask({
              id: 'active-task',
              taskId: 'active-task',
              workspaceId: 'workspace-old',
            }),
          ];
        },
        deleteTask: async (taskId) => { events.push(`delete:${taskId}`); },
        upsertTask: async (taskId) => { events.push(`upsert:${taskId}`); },
        resume: async () => { events.push('resume'); },
      },
    });

    await expect(reconciler.reconcile({
      desiredTasks: [{
        taskId: 'active-task',
        input: { workspaceId: 'workspace-new', task: 'Check for updates.' },
      }],
      resume: true,
    })).resolves.toEqual({ deleted: 2, upserted: 1, resumed: true });
    expect(events).toEqual([
      'pause',
      'list',
      'delete:retired-task',
      'delete:active-task',
      'upsert:active-task',
      'resume',
    ]);
  });

  it('does not resume after desired-state persistence fails', async () => {
    const resume = vi.fn(async () => undefined);
    const reconciler = new HostedHeartbeatTaskReconciler({
      coordinator: {
        pause: async () => undefined,
        listTasks: async () => [],
        deleteTask: async () => undefined,
        upsertTask: async () => { throw new Error('database unavailable'); },
        resume,
      },
    });

    await expect(reconciler.reconcile({
      desiredTasks: [{ taskId: 'task-1', input: { task: 'Check.' } }],
      resume: true,
    })).rejects.toThrow('database unavailable');
    expect(resume).not.toHaveBeenCalled();
  });
});

describe('HostedHeartbeatDelegationService', () => {
  it('constructs the authority wire bundle from product authorization only', async () => {
    const authorityInput: ExecutionAuthorityIssueInput[] = [];
    const service = new HostedHeartbeatDelegationService({
      authority: {
        issue: async (input) => {
          authorityInput.push(input);
          return issuedAuthority(input);
        },
      },
      authorizer: {
        authorize: async () => ({
          scope: {
            tenantId: 'tenant-1',
            subjectId: 'user-1',
            productSessionId: 'workspace-1',
          },
          allowedTools: ['read_workspace_snapshot'],
        }),
      },
      runtimeSessionNamespace: 'lucid',
      maxExecutionMs: 60_000,
      now: () => new Date('2026-08-25T00:00:00.000Z'),
    });

    const delegation = await service.issue({
      schemaVersion: 1,
      taskId: 'task-1',
      executionId: 'execution-1',
    });

    expect(delegation.deadlineAt).toBe('2026-08-25T00:01:00.000Z');
    expect(delegation.runtimeSessionId).toMatch(
      /^lucid-runtime-session-[a-f0-9]{64}$/,
    );
    expect(delegation.authority.executionAssertion).toBe('execution-token');
    expect(authorityInput).toEqual([{
      scope: delegation.scope,
      runtimeSessionId: delegation.runtimeSessionId,
      invocationId: 'execution-1',
      workflow: 'heartbeat-task',
      mcp: { allowedTools: ['read_workspace_snapshot'] },
    }]);
  });
});

function coordinatorTask(
  overrides: Partial<HostedHeartbeatCoordinatorTaskView> = {},
): HostedHeartbeatCoordinatorTaskView {
  return {
    id: 'task-1',
    taskId: 'task-1',
    workspaceId: 'workspace-1',
    name: 'Task one',
    task: 'Check for relevant changes.',
    enabled: true,
    continuationMode: 'operator',
    schedule: { intervalMs: 60_000 },
    state: { status: 'idle' },
    ...overrides,
  };
}

function issuedAuthority(
  input: ExecutionAuthorityIssueInput,
): IssuedExecutionAuthority {
  const metadata = {
    scope: { adopterId: 'lucid', ...input.scope },
    runtimeSessionId: input.runtimeSessionId,
    invocationId: input.invocationId,
    workflow: input.workflow,
    issuedAt: '2026-08-25T00:00:00.000Z',
    executionExpiresAt: '2026-08-25T00:01:00.000Z',
    mcp: {
      capabilityId: 'capability-1',
      serverId: 'lucid_product',
      allowedTools: [...(input.mcp?.allowedTools ?? [])],
      expiresAt: '2026-08-25T00:01:00.000Z',
    },
  };
  return {
    metadata,
    executionAssertion: () => 'execution-token',
    mcpCapability: () => 'mcp-token',
    toJSON: () => metadata,
  };
}
