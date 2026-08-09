import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpServerConfig } from '@/core/mcp/index.js';

const mocks = vi.hoisted(() => ({
  clientCallTool: vi.fn(),
  clientClose: vi.fn(),
  clientConnect: vi.fn(),
  clientListTools: vi.fn(),
  transportClose: vi.fn(),
  transportCreated: vi.fn(),
}));

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class {
    connect = mocks.clientConnect;
    listTools = mocks.clientListTools;
    callTool = mocks.clientCallTool;
    close = mocks.clientClose;
    getServerVersion = () => ({ name: 'fixture', version: '1.0.0' });
    getInstructions = () => undefined;
  },
}));

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: class {
    constructor(options: unknown) {
      mocks.transportCreated('stdio', options);
    }

    close = () => mocks.transportClose('stdio');
  },
}));

vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({
  SSEClientTransport: class {
    constructor(_url: URL, options: unknown) {
      mocks.transportCreated('sse', options);
    }

    close = () => mocks.transportClose('sse');
  },
}));

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: class {
    constructor(_url: URL, options: unknown) {
      mocks.transportCreated('http', options);
    }

    close = () => mocks.transportClose('http');
  },
}));

import { McpClientService } from '@/core/mcp/client-service.js';

const servers: McpServerConfig[] = [
  {
    id: 'stdio',
    transport: 'stdio',
    source: 'heddle',
    command: 'fixture',
    args: [],
    env: {},
  },
  {
    id: 'sse',
    transport: 'sse',
    source: 'heddle',
    url: 'https://example.com/sse',
    headers: {},
  },
  {
    id: 'http',
    transport: 'http',
    source: 'heddle',
    url: 'https://example.com/mcp',
    headers: {},
  },
];

describe('MCP client lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.clientConnect.mockResolvedValue(undefined);
    mocks.clientListTools.mockResolvedValue({ tools: [] });
    mocks.clientCallTool.mockResolvedValue({ content: [] });
    mocks.clientClose.mockResolvedValue(undefined);
    mocks.transportClose.mockResolvedValue(undefined);
  });

  afterEach(() => {
    delete process.env.REQUEST_SCOPED_FALLBACK;
  });

  it.each(servers)('closes client and $transport transport after successful discovery', async (server) => {
    const signal = new AbortController().signal;

    await expect(new McpClientService().listTools(server, signal)).resolves.toEqual(
      expect.objectContaining({ tools: [] }),
    );

    expect(mocks.transportCreated).toHaveBeenCalledWith(server.transport, expect.anything());
    expect(mocks.clientConnect).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ signal }),
    );
    expect(mocks.clientListTools).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ signal }),
    );
    expect(mocks.clientClose).toHaveBeenCalledTimes(1);
    expect(mocks.transportClose).toHaveBeenCalledWith(server.transport);
  });

  it('closes HTTP resources when an MCP request fails', async () => {
    mocks.clientListTools.mockRejectedValueOnce(new Error('catalog unavailable'));

    await expect(new McpClientService().listTools(servers[2]!)).rejects.toThrow(
      'catalog unavailable',
    );

    expect(mocks.clientClose).toHaveBeenCalledTimes(1);
    expect(mocks.transportClose).toHaveBeenCalledWith('http');
  });

  it.each(servers.slice(1))('resolves request-scoped headers for $transport discovery', async (server) => {
    const signal = new AbortController().signal;
    const resolveRequestHeaders = vi.fn().mockResolvedValue({
      Authorization: 'Bearer discovery-capability',
    });

    await new McpClientService().listTools(server, signal, resolveRequestHeaders);

    expect(resolveRequestHeaders).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'list_tools',
      serverId: server.id,
    }));
    const providerSignal = resolveRequestHeaders.mock.calls[0]?.[0].signal as AbortSignal;
    expect(providerSignal).toBeInstanceOf(AbortSignal);
    expect(providerSignal.aborted).toBe(false);
    const requestInit = (mocks.transportCreated.mock.calls[0]?.[1] as { requestInit: RequestInit }).requestInit;
    expect(new Headers(requestInit.headers).get('authorization')).toBe('Bearer discovery-capability');
    expect(requestInit.redirect).toBe('error');
  });

  it('resolves fresh headers for every tool-call transport', async () => {
    const resolveRequestHeaders = vi.fn()
      .mockResolvedValueOnce({ Authorization: 'Bearer capability-a' })
      .mockResolvedValueOnce({ Authorization: 'Bearer capability-b' });
    const client = new McpClientService();

    await client.callTool(servers[2]!, 'read_scope', {}, undefined, resolveRequestHeaders);
    await client.callTool(servers[2]!, 'read_scope', {}, undefined, resolveRequestHeaders);

    expect(resolveRequestHeaders).toHaveBeenNthCalledWith(1, expect.objectContaining({
      operation: 'call_tool',
      serverId: 'http',
      toolName: 'read_scope',
    }));
    const requestInits = mocks.transportCreated.mock.calls
      .map((call) => (call[1] as { requestInit: RequestInit }).requestInit);
    expect(requestInits.map((requestInit) => new Headers(requestInit.headers).get('authorization')))
      .toEqual(['Bearer capability-a', 'Bearer capability-b']);
  });

  it('keeps concurrent request-scoped providers isolated', async () => {
    const client = new McpClientService();

    await Promise.all([
      client.callTool(
        servers[2]!,
        'read_scope',
        {},
        undefined,
        async () => ({ Authorization: 'Bearer tenant-a' }),
      ),
      client.callTool(
        servers[2]!,
        'read_scope',
        {},
        undefined,
        async () => ({ Authorization: 'Bearer tenant-b' }),
      ),
    ]);

    const authorizations = mocks.transportCreated.mock.calls
      .map((call) => new Headers((call[1] as { requestInit: RequestInit }).requestInit.headers).get('authorization'));
    expect(authorizations).toEqual(expect.arrayContaining(['Bearer tenant-a', 'Bearer tenant-b']));
    expect(authorizations).toHaveLength(2);
  });

  it('never invokes a request-header provider for stdio', async () => {
    const resolveRequestHeaders = vi.fn().mockResolvedValue({ Authorization: 'Bearer unused' });

    await new McpClientService().listTools(servers[0]!, undefined, resolveRequestHeaders);

    expect(resolveRequestHeaders).not.toHaveBeenCalled();
  });

  it('redacts provider failures without falling back to configured headers', async () => {
    const server: McpServerConfig = {
      ...servers[2]!,
      headers: { Authorization: '${env:REQUEST_SCOPED_FALLBACK}' },
    };
    process.env.REQUEST_SCOPED_FALLBACK = 'forbidden-fallback';
    const resolveRequestHeaders = vi.fn().mockRejectedValue(new Error('secret-capability-value'));

    await expect(new McpClientService().listTools(server, undefined, resolveRequestHeaders))
      .rejects.toThrow('Request-scoped MCP operation failed: http/list_tools');
    await expect(new McpClientService().callTool(server, 'read_scope', {}, undefined, resolveRequestHeaders))
      .resolves.toEqual({ ok: false, error: 'Request-scoped MCP operation failed: http/call_tool' });

    expect(JSON.stringify(mocks.transportCreated.mock.calls)).not.toContain('forbidden-fallback');
  });

  it('does not invoke the provider for already-cancelled work', async () => {
    const controller = new AbortController();
    controller.abort(new Error('cancelled by owner'));
    const resolveRequestHeaders = vi.fn(() => new Promise<Readonly<Record<string, string>>>(() => undefined));

    await expect(new McpClientService().listTools(servers[2]!, controller.signal, resolveRequestHeaders))
      .rejects.toThrow('Request-scoped MCP operation failed: http/list_tools');

    expect(resolveRequestHeaders).not.toHaveBeenCalled();
    expect(mocks.transportCreated).not.toHaveBeenCalled();
  });

  it('cancels request-header resolution already in flight', async () => {
    const controller = new AbortController();
    const resolveRequestHeaders = vi.fn(() => new Promise<Readonly<Record<string, string>>>(() => undefined));

    const pending = new McpClientService().listTools(servers[2]!, controller.signal, resolveRequestHeaders);
    controller.abort(new Error('cancelled by owner'));

    await expect(pending).rejects.toThrow('Request-scoped MCP operation failed: http/list_tools');
    expect(resolveRequestHeaders).toHaveBeenCalledTimes(1);
    expect((resolveRequestHeaders.mock.calls[0]?.[0].signal as AbortSignal).aborted).toBe(true);
    expect(mocks.transportCreated).not.toHaveBeenCalled();
  });

  it('redacts request-scoped MCP server response bodies', async () => {
    const reflectedCapability = 'reflected-capability-secret';
    const resolveRequestHeaders = vi.fn().mockResolvedValue({
      Authorization: `Bearer ${reflectedCapability}`,
    });
    mocks.clientListTools.mockRejectedValueOnce(new Error(`backend echoed ${reflectedCapability}`));

    await expect(new McpClientService().listTools(servers[2]!, undefined, resolveRequestHeaders))
      .rejects.toThrow('Request-scoped MCP operation failed: http/list_tools');

    mocks.clientCallTool.mockRejectedValueOnce(new Error(`backend echoed ${reflectedCapability}`));
    const result = await new McpClientService().callTool(
      servers[2]!,
      'read_scope',
      {},
      undefined,
      resolveRequestHeaders,
    );

    expect(result).toEqual({
      ok: false,
      error: 'Request-scoped MCP operation failed: http/call_tool',
    });
    expect(JSON.stringify(result)).not.toContain(reflectedCapability);
  });
});
