import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createHostedRuntimeSessionId,
  type HostedHeartbeatDelegation,
} from '../coordinator/index.js';
import {
  NodeHostedHeartbeatDelegationHttpService,
} from '../coordinator/node/index.js';

const API_TOKEN = 'delegation-api-token-at-least-32-characters';
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>(
    (resolve, reject) => server.close((error) => error ? reject(error) : resolve()),
  )));
});

describe('NodeHostedHeartbeatDelegationHttpService', () => {
  it('owns authenticated request parsing and the delegation response edge', async () => {
    const service = new NodeHostedHeartbeatDelegationHttpService({
      apiToken: API_TOKEN,
      delegations: {
        issue: async (input) => delegation(input.taskId, input.executionId),
      },
    });
    const baseUrl = await listen(service);

    const unauthorized = await fetch(new URL(
      '/hosted-execution/internal/heartbeat-delegations',
      baseUrl,
    ), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        schemaVersion: 1,
        taskId: 'task-1',
        executionId: 'execution-1',
      }),
    });
    expect(unauthorized.status).toBe(401);

    const response = await fetch(new URL(
      '/hosted-execution/internal/heartbeat-delegations',
      baseUrl,
    ), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${API_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        schemaVersion: 1,
        taskId: 'task-1',
        executionId: 'execution-1',
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({
      taskId: 'task-1',
      executionId: 'execution-1',
      authority: { executionAssertion: 'execution-token' },
    });
    await service.close();
  });
});

describe('createHostedRuntimeSessionId', () => {
  it('is deterministic, namespaced, and bound to product scope', () => {
    const input = {
      namespace: 'lucid',
      scope: {
        tenantId: 'tenant-1',
        subjectId: 'user-1',
        productSessionId: 'workspace-1',
      },
    };
    const first = createHostedRuntimeSessionId(input);

    expect(createHostedRuntimeSessionId(input)).toBe(first);
    expect(createHostedRuntimeSessionId({
      ...input,
      scope: { ...input.scope, subjectId: 'user-2' },
    })).not.toBe(first);
    expect(first).toMatch(/^lucid-runtime-session-[a-f0-9]{64}$/);
  });
});

async function listen(
  service: NodeHostedHeartbeatDelegationHttpService,
): Promise<URL> {
  const server = createServer((request, response) => {
    if (!service.handle(request, response)) {
      response.writeHead(404).end();
    }
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected a TCP test server address.');
  }
  return new URL(`http://127.0.0.1:${address.port}`);
}

function delegation(
  taskId: string,
  executionId: string,
): HostedHeartbeatDelegation {
  const scope = {
    tenantId: 'tenant-1',
    subjectId: 'user-1',
    productSessionId: 'workspace-1',
  };
  const runtimeSessionId = createHostedRuntimeSessionId({
    namespace: 'lucid',
    scope,
  });
  return {
    schemaVersion: 1,
    taskId,
    executionId,
    scope,
    runtimeSessionId,
    deadlineAt: '2026-08-25T00:01:00.000Z',
    authority: {
      metadata: {
        scope: { adopterId: 'lucid', ...scope },
        runtimeSessionId,
        invocationId: executionId,
        workflow: 'heartbeat-task',
        issuedAt: '2026-08-25T00:00:00.000Z',
        executionExpiresAt: '2026-08-25T00:01:00.000Z',
        mcp: {
          capabilityId: 'capability-1',
          serverId: 'lucid_product',
          allowedTools: ['read_workspace_snapshot'],
          expiresAt: '2026-08-25T00:01:00.000Z',
        },
      },
      executionAssertion: 'execution-token',
      mcpCapability: 'mcp-token',
    },
  };
}
