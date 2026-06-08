import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { McpSchemas, type McpRawServerConfig } from './schemas.js';
import type {
  McpActivationStore,
  McpActivationStorePort,
  McpCatalogStore,
  McpCatalogStorePort,
  McpConfigIssue,
  McpConfigLoadResult,
  McpConfigStorePort,
  McpHttpServerConfig,
  McpServerConfig,
  McpServerConfigSource,
  McpStdioServerConfig,
} from './types.js';

const CONFIG_FILE_NAME = 'mcp.json';

export class FileMcpConfigRepository implements McpConfigStorePort {
  private readonly workspaceRoot: string;
  private readonly stateRoot: string;

  constructor(options: { workspaceRoot: string; stateRoot: string }) {
    this.workspaceRoot = resolve(options.workspaceRoot);
    this.stateRoot = resolve(options.stateRoot);
  }

  static resolvePath(stateRoot: string): string {
    return join(stateRoot, CONFIG_FILE_NAME);
  }

  read(): McpConfigLoadResult {
    const configPath = FileMcpConfigRepository.resolvePath(this.stateRoot);
    if (!existsSync(configPath)) {
      return {
        configPath,
        servers: [],
        issues: [],
      };
    }

    try {
      const parsed = McpSchemas.parseRawConfig(JSON.parse(readFileSync(configPath, 'utf8')) as unknown);
      return {
        configPath,
        ...normalizeRawConfig(parsed, {
          configPath,
          workspaceRoot: this.workspaceRoot,
        }),
      };
    } catch (error) {
      return {
        configPath,
        servers: [],
        issues: [{
          code: 'config_invalid',
          path: configPath,
          message: error instanceof Error ? error.message : String(error),
        }],
      };
    }
  }
}

export class FileMcpActivationRepository implements McpActivationStorePort {
  private readonly filePath: string;

  constructor(options: { stateRoot: string }) {
    this.filePath = FileMcpActivationRepository.resolvePath(options.stateRoot);
  }

  static resolvePath(stateRoot: string): string {
    return join(stateRoot, 'mcp', 'activation.json');
  }

  read(): McpActivationStore {
    if (!existsSync(this.filePath)) {
      return McpSchemas.emptyActivationStore();
    }

    try {
      return McpSchemas.parseActivationStore(JSON.parse(readFileSync(this.filePath, 'utf8')) as unknown);
    } catch {
      return McpSchemas.emptyActivationStore();
    }
  }

  write(store: McpActivationStore): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, `${JSON.stringify(McpSchemas.parseActivationStore(store), null, 2)}\n`, 'utf8');
  }
}

export class FileMcpCatalogRepository implements McpCatalogStorePort {
  private readonly filePath: string;

  constructor(options: { stateRoot: string }) {
    this.filePath = FileMcpCatalogRepository.resolvePath(options.stateRoot);
  }

  static resolvePath(stateRoot: string): string {
    return join(stateRoot, 'mcp', 'catalog.json');
  }

  read(): McpCatalogStore {
    if (!existsSync(this.filePath)) {
      return McpSchemas.emptyCatalogStore();
    }

    try {
      return McpSchemas.parseCatalogStore(JSON.parse(readFileSync(this.filePath, 'utf8')) as unknown);
    } catch {
      return McpSchemas.emptyCatalogStore();
    }
  }

  write(store: McpCatalogStore): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, `${JSON.stringify(McpSchemas.parseCatalogStore(store), null, 2)}\n`, 'utf8');
  }
}

function normalizeRawConfig(
  config: ReturnType<typeof McpSchemas.parseRawConfig>,
  options: { configPath: string; workspaceRoot: string },
): {
  servers: McpServerConfig[];
  issues: McpConfigIssue[];
} {
  const standardServers = config.mcpServers ?? {};
  const vscodeServers = config.servers ?? {};
  const standard = Object.entries(standardServers).map(([id, server]) => normalizeServer(id, server, {
    source: 'standard',
    ...options,
  }));
  const vscode = Object.entries(vscodeServers)
    .filter(([id]) => standardServers[id] === undefined)
    .map(([id, server]) => normalizeServer(id, server, {
      source: 'vscode',
      ...options,
    }));
  const normalized = [...standard, ...vscode];

  return {
    servers: normalized.flatMap((result) => result.server ? [result.server] : []),
    issues: normalized.flatMap((result) => result.issues),
  };
}

function normalizeServer(
  id: string,
  raw: McpRawServerConfig,
  options: {
    configPath: string;
    source: McpServerConfigSource;
    workspaceRoot: string;
  },
): {
  server?: McpServerConfig;
  issues: McpConfigIssue[];
} {
  const transport = normalizeTransport(raw.type ?? raw.transport, raw);
  const path = `${options.configPath}#${id}`;

  if (!isSafeIdentifier(id)) {
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
    if (!raw.command) {
      return {
        issues: [{
          code: 'server_invalid',
          path,
          message: 'Stdio MCP server requires command.',
        }],
      };
    }

    const server: McpStdioServerConfig = {
      id,
      transport,
      source: options.source,
      command: raw.command,
      args: raw.args ?? [],
      cwd: raw.cwd ? resolveTemplatePath(raw.cwd, options.workspaceRoot) : undefined,
      env: raw.env ?? {},
      envFile: raw.envFile,
      tools: raw.tools,
    };
    return { server, issues: [] };
  }

  if (!raw.url) {
    return {
      issues: [{
        code: 'server_invalid',
        path,
        message: 'HTTP MCP server requires url.',
      }],
    };
  }

  try {
    const url = new URL(raw.url);
    const server: McpHttpServerConfig = {
      id,
      transport,
      source: options.source,
      url: url.toString(),
      headers: raw.headers ?? {},
      tools: raw.tools,
    };
    return { server, issues: [] };
  } catch {
    return {
      issues: [{
        code: 'server_invalid',
        path,
        message: `Invalid MCP server URL: ${raw.url}`,
      }],
    };
  }
}

function normalizeTransport(
  value: string | undefined,
  raw: McpRawServerConfig,
): McpServerConfig['transport'] | undefined {
  if (!value && raw.command) {
    return 'stdio';
  }

  if (value === 'streamable-http') {
    return 'http';
  }

  if (value === 'stdio' || value === 'http' || value === 'sse') {
    return value;
  }

  return undefined;
}

function resolveTemplatePath(value: string, workspaceRoot: string): string {
  return value.replaceAll('${workspaceFolder}', workspaceRoot);
}

function isSafeIdentifier(value: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(value);
}
