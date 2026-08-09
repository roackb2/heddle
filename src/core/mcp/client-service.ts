import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type {
  McpCallToolResult,
  McpClientSessionInfo,
  McpHttpServerConfig,
  McpRequestHeadersProviderInput,
  McpRequestHeadersProvider,
  McpServerConfig,
  McpToolDescriptor,
} from './types.js';

const DEFAULT_MCP_TIMEOUT_MS = 30_000;

export class McpClientService {
  async listTools(
    server: McpServerConfig,
    signal?: AbortSignal,
    requestHeaders?: McpRequestHeadersProvider,
  ): Promise<McpClientSessionInfo> {
    try {
      return await this.withClient(server, async (client) => {
        const tools = await client.listTools({}, {
          signal,
          timeout: DEFAULT_MCP_TIMEOUT_MS,
        });
        const serverVersion = client.getServerVersion();

        return {
          serverName: serverVersion?.name,
          serverVersion: serverVersion?.version,
          instructions: client.getInstructions(),
          tools: tools.tools.map(toToolDescriptor),
        };
      }, { operation: 'list_tools', serverId: server.id, signal }, signal, requestHeaders);
    } catch (error) {
      if (requestHeaders) {
        throw requestScopedOperationError(server.id, 'list_tools');
      }
      throw error;
    }
  }

  async callTool(
    server: McpServerConfig,
    toolName: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
    requestHeaders?: McpRequestHeadersProvider,
  ): Promise<McpCallToolResult> {
    try {
      return await this.withClient(server, async (client) => {
        const result = await client.callTool({
          name: toolName,
          arguments: args,
        }, undefined, {
          signal,
          timeout: DEFAULT_MCP_TIMEOUT_MS,
        });

        return {
          ok: true,
          output: normalizeToolResult(result),
        };
      }, { operation: 'call_tool', serverId: server.id, toolName, signal }, signal, requestHeaders);
    } catch (error) {
      return {
        ok: false,
        error: requestHeaders
          ? requestScopedOperationError(server.id, 'call_tool').message
          : error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async withClient<T>(
    server: McpServerConfig,
    callback: (client: Client) => Promise<T>,
    operation: McpRequestHeadersProviderInput,
    signal?: AbortSignal,
    requestHeaders?: McpRequestHeadersProvider,
  ): Promise<T> {
    const client = new Client({
      name: 'heddle',
      version: '0.0.0',
    });
    const transport = await createTransport(server, operation, requestHeaders);

    try {
      await client.connect(transport, {
        signal,
        timeout: DEFAULT_MCP_TIMEOUT_MS,
      });
      return await callback(client);
    } finally {
      await client.close().catch(() => undefined);
      await transport.close().catch(() => undefined);
    }
  }
}

function requestScopedOperationError(serverId: string, operation: 'list_tools' | 'call_tool'): Error {
  return new Error(`Request-scoped MCP operation failed: ${serverId}/${operation}`);
}

async function createTransport(
  server: McpServerConfig,
  operation: McpRequestHeadersProviderInput,
  requestHeaders?: McpRequestHeadersProvider,
): Promise<Transport> {
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
      requestInit: await resolveHttpRequestInit(server, operation, requestHeaders),
    });
  }

  return new StreamableHTTPClientTransport(new URL(server.url), {
    requestInit: await resolveHttpRequestInit(server, operation, requestHeaders),
  });
}

async function resolveHttpRequestInit(
  server: McpHttpServerConfig,
  operation: McpRequestHeadersProviderInput,
  provider?: McpRequestHeadersProvider,
): Promise<RequestInit> {
  if (!provider) {
    return { headers: new Headers(resolveEnv(server.headers)) };
  }

  try {
    const timeoutSignal = AbortSignal.timeout(DEFAULT_MCP_TIMEOUT_MS);
    const providerSignal = operation.signal
      ? AbortSignal.any([operation.signal, timeoutSignal])
      : timeoutSignal;
    providerSignal.throwIfAborted();
    const providerOperation = { ...operation, signal: providerSignal };
    const provided = await settleWithSignal(
      Promise.resolve(provider(providerOperation)),
      providerSignal,
    );
    return {
      headers: new Headers(provided),
      redirect: 'error',
    };
  } catch {
    throw new Error(`MCP request headers unavailable: ${server.id}/${operation.operation}`);
  }
}

async function settleWithSignal<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    throw signal.reason;
  }

  return await new Promise<T>((resolve, reject) => {
    const rejectOnAbort = () => reject(signal.reason);
    signal.addEventListener('abort', rejectOnAbort, { once: true });
    pending.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', rejectOnAbort);
    });
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
