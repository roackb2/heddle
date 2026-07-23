import { beforeEach, describe, expect, it, vi } from 'vitest';
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
    constructor() {
      mocks.transportCreated('stdio');
    }

    close = () => mocks.transportClose('stdio');
  },
}));

vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({
  SSEClientTransport: class {
    constructor() {
      mocks.transportCreated('sse');
    }

    close = () => mocks.transportClose('sse');
  },
}));

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: class {
    constructor() {
      mocks.transportCreated('http');
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

  it.each(servers)('closes client and $transport transport after successful discovery', async (server) => {
    const signal = new AbortController().signal;

    await expect(new McpClientService().listTools(server, signal)).resolves.toEqual(
      expect.objectContaining({ tools: [] }),
    );

    expect(mocks.transportCreated).toHaveBeenCalledWith(server.transport);
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
});
