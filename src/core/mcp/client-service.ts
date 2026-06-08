import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { McpCallToolResult, McpClientSessionInfo, McpServerConfig, McpToolDescriptor } from './types.js';

const DEFAULT_MCP_TIMEOUT_MS = 30_000;

export class McpClientService {
  async listTools(server: McpServerConfig): Promise<McpClientSessionInfo> {
    return await this.withClient(server, async (client) => {
      const tools = await client.listTools({}, { timeout: DEFAULT_MCP_TIMEOUT_MS });
      const serverVersion = client.getServerVersion();

      return {
        serverName: serverVersion?.name,
        serverVersion: serverVersion?.version,
        instructions: client.getInstructions(),
        tools: tools.tools.map(toToolDescriptor),
      };
    });
  }

  async callTool(
    server: McpServerConfig,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<McpCallToolResult> {
    try {
      return await this.withClient(server, async (client) => {
        const result = await client.callTool({
          name: toolName,
          arguments: args,
        }, undefined, { timeout: DEFAULT_MCP_TIMEOUT_MS });

        return {
          ok: true,
          output: normalizeToolResult(result),
        };
      });
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async withClient<T>(
    server: McpServerConfig,
    callback: (client: Client) => Promise<T>,
  ): Promise<T> {
    const client = new Client({
      name: 'heddle',
      version: '0.0.0',
    });
    const transport = createTransport(server);

    try {
      await client.connect(transport, { timeout: DEFAULT_MCP_TIMEOUT_MS });
      return await callback(client);
    } finally {
      await client.close().catch(() => undefined);
      await transport.close().catch(() => undefined);
    }
  }
}

function createTransport(server: McpServerConfig): Transport {
  if (server.transport === 'stdio') {
    return new StdioClientTransport({
      command: server.command,
      args: server.args,
      cwd: server.cwd,
      env: resolveEnv(server.env),
      stderr: 'pipe',
    });
  }

  if (server.transport === 'sse') {
    return new SSEClientTransport(new URL(server.url), {
      requestInit: {
        headers: resolveEnv(server.headers),
      },
    });
  }

  return new StreamableHTTPClientTransport(new URL(server.url), {
    requestInit: {
      headers: resolveEnv(server.headers),
    },
  });
}

function resolveEnv(values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, value.replace(/\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, envKey: string) => (
      process.env[envKey] ?? ''
    ))]),
  );
}

function toToolDescriptor(tool: {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}): McpToolDescriptor {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema,
    annotations: tool.annotations,
  };
}

function normalizeToolResult(result: unknown): unknown {
  if (!result || typeof result !== 'object') {
    return result;
  }

  const value = result as {
    content?: unknown[];
    structuredContent?: unknown;
    isError?: boolean;
    toolResult?: unknown;
  };

  if (value.toolResult !== undefined) {
    return value.toolResult;
  }

  return {
    isError: value.isError ?? false,
    structuredContent: value.structuredContent,
    content: value.content,
  };
}
