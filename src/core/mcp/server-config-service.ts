import type { McpRawServerConfig } from './schemas.js';
import type {
  McpConfigIssue,
  McpHttpServerConfig,
  McpServerConfig,
  McpServerConfigSource,
  McpStdioServerConfig,
} from './types.js';

export type McpServerConfigNormalizationResult = {
  server?: McpServerConfig;
  issues: McpConfigIssue[];
};

/**
 * Owns normalization of standard and VS Code MCP server definitions.
 *
 * File-backed configuration and request-scoped hosted preparation use
 * the same validation path so transport and policy semantics cannot drift.
 */
export class McpServerConfigService {
  static normalizeConfig(
    config: {
      mcpServers?: Record<string, McpRawServerConfig>;
      servers?: Record<string, McpRawServerConfig>;
    },
    options: { configPath: string; workspaceRoot: string },
  ): {
    servers: McpServerConfig[];
    issues: McpConfigIssue[];
  } {
    const standardServers = config.mcpServers ?? {};
    const vscodeServers = config.servers ?? {};
    const standard = Object.entries(standardServers).map(([id, server]) => this.normalizeServer(id, server, {
      source: 'standard',
      ...options,
    }));
    const vscode = Object.entries(vscodeServers)
      .filter(([id]) => standardServers[id] === undefined)
      .map(([id, server]) => this.normalizeServer(id, server, {
        source: 'vscode',
        ...options,
      }));
    const normalized = [...standard, ...vscode];

    return {
      servers: normalized.flatMap((result) => result.server ? [result.server] : []),
      issues: normalized.flatMap((result) => result.issues),
    };
  }

  static normalizeServer(
    id: string,
    raw: McpRawServerConfig,
    options: {
      configPath: string;
      source: McpServerConfigSource;
      workspaceRoot: string;
    },
  ): McpServerConfigNormalizationResult {
    const transport = this.normalizeTransport(raw.type ?? raw.transport, raw);
    const path = `${options.configPath}#${id}`;

    if (!this.isSafeIdentifier(id)) {
      return {
        issues: [{
          code: 'server_invalid',
          path,
          message: `MCP server id must use letters, numbers, underscores, or hyphens: ${id}`,
        }],
      };
    }

    if (!transport) {
      return {
        issues: [{
          code: 'unsupported_transport',
          path,
          message: 'MCP server must define a supported transport: stdio, http, streamable-http, or sse.',
        }],
      };
    }

    if (transport === 'stdio') {
      return this.normalizeStdioServer({ id, raw, options, path });
    }

    return this.normalizeHttpServer({ id, raw, options, path, transport });
  }

  private static normalizeStdioServer(input: {
    id: string;
    raw: McpRawServerConfig;
    options: { source: McpServerConfigSource; workspaceRoot: string };
    path: string;
  }): McpServerConfigNormalizationResult {
    if (!input.raw.command) {
      return {
        issues: [{
          code: 'server_invalid',
          path: input.path,
          message: 'Stdio MCP server requires command.',
        }],
      };
    }

    const server: McpStdioServerConfig = {
      id: input.id,
      transport: 'stdio',
      source: input.options.source,
      command: input.raw.command,
      args: input.raw.args ?? [],
      cwd: input.raw.cwd ? this.resolveTemplatePath(input.raw.cwd, input.options.workspaceRoot) : undefined,
      env: input.raw.env ?? {},
      envFile: input.raw.envFile,
      environment: input.raw.environment,
      tools: input.raw.tools,
    };
    return { server, issues: [] };
  }

  private static normalizeHttpServer(input: {
    id: string;
    raw: McpRawServerConfig;
    options: { source: McpServerConfigSource };
    path: string;
    transport: 'http' | 'sse';
  }): McpServerConfigNormalizationResult {
    if (!input.raw.url) {
      return {
        issues: [{
          code: 'server_invalid',
          path: input.path,
          message: 'HTTP MCP server requires url.',
        }],
      };
    }

    try {
      const server: McpHttpServerConfig = {
        id: input.id,
        transport: input.transport,
        source: input.options.source,
        url: new URL(input.raw.url).toString(),
        headers: input.raw.headers ?? {},
        environment: input.raw.environment,
        tools: input.raw.tools,
      };
      return { server, issues: [] };
    } catch {
      return {
        issues: [{
          code: 'server_invalid',
          path: input.path,
          message: `Invalid MCP server URL: ${input.raw.url}`,
        }],
      };
    }
  }

  private static normalizeTransport(
    value: string | undefined,
    raw: McpRawServerConfig,
  ): McpServerConfig['transport'] | undefined {
    if (!value && raw.command) {
      return 'stdio';
    }

    if (value === 'streamable-http') {
      return 'http';
    }

    return value === 'stdio' || value === 'http' || value === 'sse'
      ? value
      : undefined;
  }

  private static resolveTemplatePath(value: string, workspaceRoot: string): string {
    return value.replaceAll('${workspaceFolder}', workspaceRoot);
  }

  private static isSafeIdentifier(value: string): boolean {
    return /^[A-Za-z0-9_-]+$/.test(value);
  }
}
