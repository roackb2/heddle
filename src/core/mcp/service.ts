import dayjs from 'dayjs';
import {
  FileMcpActivationRepository,
  FileMcpCatalogRepository,
  FileMcpConfigRepository,
} from './repositories.js';
import { McpClientService } from './client-service.js';
import type {
  McpActivationResult,
  McpActivationStorePort,
  McpCallToolResult,
  McpCatalogStorePort,
  McpConfigStorePort,
  McpOverview,
  McpRefreshResult,
  McpServerActivationRecord,
  McpServerConfig,
  McpServerView,
  McpServiceOptions,
} from './types.js';

export class McpService {
  private readonly stateRoot: string;
  private readonly configStore: McpConfigStorePort;
  private readonly activationStore: McpActivationStorePort;
  private readonly catalogStore: McpCatalogStorePort;
  private readonly clientService: McpClientService;

  constructor(options: McpServiceOptions) {
    this.stateRoot = options.stateRoot;
    this.configStore = options.configStore ?? new FileMcpConfigRepository({
      workspaceRoot: options.workspaceRoot,
      stateRoot: options.stateRoot,
    });
    this.activationStore = options.activationStore ?? new FileMcpActivationRepository({ stateRoot: options.stateRoot });
    this.catalogStore = options.catalogStore ?? new FileMcpCatalogRepository({ stateRoot: options.stateRoot });
    this.clientService = new McpClientService();
  }

  listOverview(): McpOverview {
    const config = this.configStore.read();
    return {
      configPath: config.configPath,
      activationStorePath: FileMcpActivationRepository.resolvePath(this.stateRoot),
      catalogStorePath: FileMcpCatalogRepository.resolvePath(this.stateRoot),
      servers: this.buildServerViews(config.servers),
      issues: config.issues,
    };
  }

  activateServer(serverId: string, now = new Date()): McpActivationResult {
    const config = this.configStore.read();
    const server = config.servers.find((candidate) => candidate.id === serverId);
    if (!server) {
      return { ok: false, reason: 'server_not_found', serverId };
    }

    const store = this.activationStore.read();
    const timestamp = now.toISOString();
    const existing = store.servers[serverId];
    const record: McpServerActivationRecord = {
      serverId,
      status: 'enabled',
      activatedAt: existing?.activatedAt ?? timestamp,
      updatedAt: timestamp,
    };

    store.servers[serverId] = record;
    this.activationStore.write(store);

    return { ok: true, record };
  }

  disableServer(serverId: string, now = new Date()): McpActivationResult {
    const store = this.activationStore.read();
    const existing = store.servers[serverId];

    if (!existing || existing.status !== 'enabled') {
      return { ok: false, reason: 'server_not_enabled', serverId };
    }

    const record: McpServerActivationRecord = {
      ...existing,
      status: 'disabled',
      updatedAt: now.toISOString(),
    };

    store.servers[serverId] = record;
    this.activationStore.write(store);

    return { ok: true, record };
  }

  async refreshServer(serverId: string, now = new Date()): Promise<McpRefreshResult> {
    const config = this.configStore.read();
    const server = config.servers.find((candidate) => candidate.id === serverId);
    if (!server) {
      return {
        ok: false,
        reason: 'server_not_found',
        serverId,
        error: `MCP server not found: ${serverId}`,
      };
    }

    if (!this.enabledServerIds().has(serverId)) {
      return {
        ok: false,
        reason: 'server_not_enabled',
        serverId,
        error: `MCP server is not enabled: ${serverId}`,
      };
    }

    try {
      const discovered = await this.clientService.listTools(server);
      const store = this.catalogStore.read();
      const record = {
        serverId,
        protocolVersion: discovered.protocolVersion,
        serverName: discovered.serverName,
        serverVersion: discovered.serverVersion,
        instructions: discovered.instructions,
        tools: discovered.tools,
        refreshedAt: now.toISOString(),
      };
      store.servers[serverId] = record;
      this.catalogStore.write(store);
      return { ok: true, record };
    } catch (error) {
      return {
        ok: false,
        reason: 'connection_failed',
        serverId,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async refreshEnabledServers(now = new Date()): Promise<McpRefreshResult[]> {
    const config = this.configStore.read();
    const enabledIds = this.enabledServerIds();
    return await Promise.all(
      config.servers
        .filter((server) => enabledIds.has(server.id))
        .map((server) => this.refreshServer(server.id, now)),
    );
  }

  async callTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<McpCallToolResult> {
    const config = this.configStore.read();
    const server = config.servers.find((candidate) => candidate.id === serverId);
    if (!server) {
      return { ok: false, error: `MCP server not found: ${serverId}` };
    }

    if (!this.enabledServerIds().has(serverId)) {
      return { ok: false, error: `MCP server is not enabled: ${serverId}` };
    }

    const catalog = this.catalogStore.read().servers[serverId];
    if (!catalog?.tools.some((tool) => tool.name === toolName)) {
      return { ok: false, error: `MCP tool not found in cached catalog: ${serverId}/${toolName}` };
    }

    if (!isToolAllowed(server, toolName)) {
      return { ok: false, error: `MCP tool is denied by Heddle config: ${serverId}/${toolName}` };
    }

    return await this.clientService.callTool(server, toolName, args);
  }

  private buildServerViews(servers: McpServerConfig[]): McpServerView[] {
    const records = this.activationStore.read().servers;
    const catalogs = this.catalogStore.read().servers;
    const viewsById = new Map<string, McpServerView>();

    for (const server of servers) {
      const record = records[server.id];
      const catalog = catalogs[server.id];
      const status = record?.status === 'enabled'
        ? 'enabled'
        : record?.status === 'disabled'
          ? 'disabled'
          : 'available';

      viewsById.set(server.id, {
        id: server.id,
        status,
        config: server,
        record,
        catalog,
        toolCount: catalog?.tools.length ?? 0,
        action: status === 'enabled' ? `/mcp disable ${server.id}` : `/mcp enable ${server.id}`,
      });
    }

    for (const record of Object.values(records)) {
      if (!viewsById.has(record.serverId)) {
        viewsById.set(record.serverId, {
          id: record.serverId,
          status: 'missing',
          record,
          toolCount: 0,
          action: 'restore the MCP server config or disable the stale activation record',
        });
      }
    }

    return Array.from(viewsById.values()).sort((left, right) => left.id.localeCompare(right.id));
  }

  private enabledServerIds(): Set<string> {
    return new Set(
      Object.values(this.activationStore.read().servers)
        .filter((record) => record.status === 'enabled')
        .map((record) => record.serverId),
    );
  }
}

export function createMcpService(options: McpServiceOptions): McpService {
  return new McpService(options);
}

export function isToolAllowed(server: McpServerConfig, toolName: string): boolean {
  const policy = server.tools;
  if (policy?.deny?.includes(toolName)) {
    return false;
  }

  if (policy?.allow && !policy.allow.includes(toolName)) {
    return false;
  }

  return true;
}

export function shouldMcpToolRequireApproval(server: McpServerConfig): boolean {
  return server.tools?.approval !== 'never';
}

export function mcpTimestamp(): string {
  return dayjs().toISOString();
}
