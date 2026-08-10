import {
  createServer,
  type IncomingMessage,
  type Server,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { z } from 'zod';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  McpCapabilityUnavailableError,
  McpCapabilityVerificationError,
  type McpCapabilityVerifier,
  type VerifiedMcpCapability,
} from '../mcp/index.js';
import {
  NodeStreamableHttpMcpService,
  type NodeMcpToolset,
} from '../mcp/node/index.js';

const running = new Set<RunningMcpService>();

afterEach(async () => {
  await Promise.all([...running].map((service) => service.close()));
  running.clear();
});

describe('Node Streamable HTTP MCP service', () => {
  it('verifies every request and exposes only capability-selected tools', async () => {
    let currentRequest: IncomingMessage | undefined;
    const verify = vi.fn(async (assertion: string) => {
      expect(assertion).toBe('aaa.bbb.ccc');
      expect(currentRequest?.headers.authorization).toBe('[REDACTED]');
      expect(currentRequest?.rawHeaders).not.toContain('Bearer aaa.bbb.ccc');
      return capability(['read_scope']);
    });
    const service = new NodeStreamableHttpMcpService<ToolName>({
      capabilityVerifier: { verify },
      toolset: toolset(),
    });
    const app = await start(service, (request) => {
      currentRequest = request;
    });
    const client = await connect(app.endpoint);
    app.clients.add(client);

    const tools = await client.listTools();
    const result = await client.callTool({ name: 'read_scope', arguments: {} });

    expect(tools.tools.map(({ name }) => name)).toEqual(['read_scope']);
    expect(JSON.stringify(result)).toContain('company-a');
    expect(verify.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('returns safe auth failures before creating product tools', async () => {
    const registerAllowedTools = vi.fn();
    const service = new NodeStreamableHttpMcpService<ToolName>({
      capabilityVerifier: {
        verify: async () => { throw new McpCapabilityVerificationError(); },
      },
      toolset: {
        serverInfo: { name: 'test-product', version: '1.0.0' },
        registerAllowedTools,
      },
    });
    const app = await start(service);

    const response = await postJsonRpc(app.endpoint, 'Bearer aaa.bbb.ccc');
    const body = await response.text();

    expect(response.status).toBe(401);
    expect(body).toContain('Authentication failed.');
    expect(body).not.toContain('aaa.bbb.ccc');
    expect(registerAllowedTools).not.toHaveBeenCalled();
  });

  it('distinguishes a temporarily unavailable verifier', async () => {
    const service = new NodeStreamableHttpMcpService<ToolName>({
      capabilityVerifier: {
        verify: async () => { throw new McpCapabilityUnavailableError('jwks'); },
      },
      toolset: toolset(),
    });
    const app = await start(service);

    const response = await postJsonRpc(app.endpoint, 'Bearer aaa.bbb.ccc');

    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toBe('1');
  });

  it('bounds request bodies before constructing SDK resources', async () => {
    const registerAllowedTools = vi.fn();
    const service = new NodeStreamableHttpMcpService<ToolName>({
      capabilityVerifier: verifier(),
      toolset: {
        serverInfo: { name: 'test-product', version: '1.0.0' },
        registerAllowedTools,
      },
      maxBodyBytes: 32,
    });
    const app = await start(service);

    const response = await postJsonRpc(app.endpoint, 'Bearer aaa.bbb.ccc');

    expect(response.status).toBe(413);
    expect(registerAllowedTools).not.toHaveBeenCalled();
  });

  it('aborts an in-flight product tool during service shutdown', async () => {
    let aborted = false;
    let enter!: () => void;
    const entered = new Promise<void>((resolve) => { enter = resolve; });
    const service = new NodeStreamableHttpMcpService<ToolName>({
      capabilityVerifier: verifier(['wait_for_shutdown']),
      toolset: {
        serverInfo: { name: 'test-product', version: '1.0.0' },
        registerAllowedTools: ({ server, requestSignal }) => {
          server.registerTool(
            'wait_for_shutdown',
            { inputSchema: z.object({}).strict() },
            async (_input, extra) => {
              enter();
              const signal = AbortSignal.any([requestSignal, extra.signal]);
              await new Promise<void>((resolve) => {
                signal.addEventListener('abort', () => {
                  aborted = true;
                  resolve();
                }, { once: true });
              });
              return {
                isError: true,
                content: [{ type: 'text', text: 'cancelled' }],
              };
            },
          );
        },
      },
    });
    const app = await start(service);
    const client = await connect(app.endpoint);
    app.clients.add(client);
    const call = client.callTool({ name: 'wait_for_shutdown', arguments: {} });
    await entered;

    const closing = service.close();
    await vi.waitFor(() => expect(aborted).toBe(true));
    await client.close();
    app.clients.delete(client);
    await call.catch(() => undefined);
    await closing;
  });
});

type ToolName = 'read_scope' | 'wait_for_shutdown';

function toolset(): NodeMcpToolset<ToolName> {
  return {
    serverInfo: { name: 'test-product', version: '1.0.0' },
    registerAllowedTools: ({ server, capability: verified }) => {
      if (verified.allowedTools.includes('read_scope')) {
        server.registerTool(
          'read_scope',
          { inputSchema: z.object({}).strict() },
          async () => ({
            content: [{
              type: 'text',
              text: JSON.stringify(verified.scope),
            }],
          }),
        );
      }
    },
  };
}

function verifier(
  tools: readonly ToolName[] = ['read_scope'],
): McpCapabilityVerifier<ToolName> {
  return { verify: async () => capability(tools) };
}

function capability(
  tools: readonly ToolName[],
): VerifiedMcpCapability<ToolName> {
  return Object.freeze({
    capabilityId: 'capability-001',
    serverId: 'product_capabilities',
    allowedTools: Object.freeze([...tools]),
    scope: Object.freeze({
      adopterId: 'example-adopter',
      tenantId: 'company-a',
      subjectId: 'user-a',
      productSessionId: 'conversation-a',
      runtimeSessionId: 'runtime-session-001-abcdefghijklmnop',
      invocationId: 'invocation-001',
      workflow: 'conversation-turn',
    }),
    issuedAt: '2026-08-10T12:00:00.000Z',
    expiresAt: '2026-08-10T12:10:00.000Z',
  });
}

type RunningMcpService = {
  endpoint: URL;
  clients: Set<Client>;
  close(): Promise<void>;
};

async function start(
  service: NodeStreamableHttpMcpService<ToolName>,
  observeRequest?: (request: IncomingMessage) => void,
): Promise<RunningMcpService> {
  const server = createServer((request, response) => {
    observeRequest?.(request);
    void service.handle(request, response);
  });
  await listen(server);
  const address = server.address() as AddressInfo;
  const clients = new Set<Client>();
  const app = {
    endpoint: new URL(`http://127.0.0.1:${address.port}/mcp`),
    clients,
    close: async () => {
      await Promise.all([...clients].map((client) => (
        client.close().catch(() => undefined)
      )));
      await service.close();
      await closeServer(server);
    },
  };
  running.add(app);
  return app;
}

async function connect(endpoint: URL): Promise<Client> {
  const client = new Client({ name: 'adopter-test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(endpoint, {
    requestInit: {
      headers: { Authorization: 'Bearer aaa.bbb.ccc' },
    },
  }));
  return client;
}

function postJsonRpc(endpoint: URL, authorization: string): Promise<Response> {
  return fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: authorization,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {},
    }),
  });
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}
