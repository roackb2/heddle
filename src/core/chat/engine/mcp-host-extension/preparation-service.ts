import dayjs from 'dayjs';
import { McpClientService, McpService } from '@/core/mcp/index.js';
import { McpSchemas } from '@/core/mcp/schemas.js';
import { McpServerConfigService } from '@/core/mcp/server-config-service.js';
import { McpHostExtensionService } from './service.js';
import { McpHostValueService } from './value-service.js';
import type {
  PrepareMcpHostExtensionCatalogOptions,
  PrepareMcpHostExtensionCatalogResult,
  PrepareMcpHostExtensionInput,
  PrepareMcpHostExtensionOptions,
  PrepareMcpHostExtensionResult,
  PrepareRequestScopedMcpHostExtensionOptions,
  PrepareRequestScopedMcpHostExtensionResult,
} from './types.js';

/**
 * Owns the setup lifecycle for MCP-backed host extensions.
 *
 * Workspace preparation writes config, activation, and catalog state.
 * Request-scoped preparation validates and discovers entirely in memory, then
 * embeds the server, catalog, and credential resolver into one extension.
 * Runtime execution stays in `McpHostToolDefinitionService`.
 */
export class McpHostExtensionPreparationService {
  static async prepareCatalog(
    options: PrepareMcpHostExtensionCatalogOptions,
  ): Promise<PrepareMcpHostExtensionCatalogResult> {
    const mcp = new McpService({
      workspaceRoot: options.workspaceRoot,
      stateRoot: options.stateRoot,
    });
    const currentDocument = mcp.readConfigDocument();

    if (currentDocument.issues.length > 0) {
      return {
        ok: false,
        serverId: options.serverId,
        step: 'save_config',
        error: currentDocument.issues.map((issue) => issue.message).join('; '),
      };
    }

    const save = mcp.saveConfigDocument(McpHostExtensionPreparationService.buildConfigDocumentContent({
      content: currentDocument.content,
      serverId: options.serverId,
      server: options.server,
    }));

    if (!save.ok) {
      return {
        ok: false,
        serverId: options.serverId,
        step: 'save_config',
        error: save.error,
      };
    }

    const activation = mcp.activateServer(options.serverId);
    if (!activation.ok) {
      return {
        ok: false,
        serverId: options.serverId,
        step: 'activate_server',
        error: activation.reason,
      };
    }

    const refresh = await mcp.refreshServer(options.serverId);
    if (!refresh.ok) {
      return {
        ok: false,
        serverId: options.serverId,
        step: 'refresh_catalog',
        error: refresh.error,
      };
    }

    const resolvedServer = mcp
      .listOverview()
      .servers.find((server) => server.id === options.serverId)?.config;
    if (!resolvedServer) {
      return {
        ok: false,
        serverId: options.serverId,
        step: 'refresh_catalog',
        error: `Resolved server config missing after refresh: ${options.serverId}`,
      };
    }

    return {
      ok: true,
      serverId: options.serverId,
      refresh,
      resolvedServer,
      toolNames: refresh.record.tools.map((tool) => tool.name),
    };
  }

  static async prepare(
    options: PrepareMcpHostExtensionInput,
  ): Promise<PrepareMcpHostExtensionResult | PrepareRequestScopedMcpHostExtensionResult> {
    return this.isRequestScoped(options)
      ? await this.prepareRequestScoped(options)
      : await this.prepareWorkspace(options);
  }

  private static async prepareWorkspace(
    options: PrepareMcpHostExtensionOptions,
  ): Promise<PrepareMcpHostExtensionResult> {
    const prepared = await McpHostExtensionPreparationService.prepareCatalog({
      workspaceRoot: options.workspaceRoot,
      stateRoot: options.stateRoot,
      serverId: options.serverId,
      server: options.server,
    });

    return prepared.ok
      ? {
          ...prepared,
          extension: McpHostExtensionService.define(options, {
            server: prepared.resolvedServer,
            catalog: prepared.refresh.record,
          }),
        }
      : prepared;
  }

  private static async prepareRequestScoped(
    options: PrepareRequestScopedMcpHostExtensionOptions,
  ): Promise<PrepareRequestScopedMcpHostExtensionResult> {
    if ('workspaceRoot' in options || 'stateRoot' in options) {
      return this.requestScopedFailure(
        options.serverId,
        'validate_server',
        'Request-scoped MCP preparation cannot use workspace or state roots.',
      );
    }

    if ('headers' in options.server) {
      return this.requestScopedFailure(
        options.serverId,
        'validate_server',
        'Request-scoped MCP servers must resolve all headers through resolveRequestHeaders.',
      );
    }

    let parsed: ReturnType<typeof McpSchemas.parseRawConfig>;
    try {
      parsed = McpSchemas.parseRawConfig({
        mcpServers: {
          [options.serverId]: options.server,
        },
      });
    } catch (error) {
      return this.requestScopedFailure(options.serverId, 'validate_server', error);
    }

    const normalized = McpServerConfigService.normalizeConfig(parsed, {
      configPath: 'request-scoped:mcp',
      workspaceRoot: '',
    });
    const server = normalized.servers.find((candidate) => candidate.id === options.serverId);
    if (!server || normalized.issues.length > 0) {
      return this.requestScopedFailure(
        options.serverId,
        'validate_server',
        normalized.issues.map((issue) => issue.message).join('; ') || 'MCP server configuration is invalid.',
      );
    }

    if (server.transport === 'stdio') {
      return this.requestScopedFailure(
        options.serverId,
        'validate_server',
        'Request-scoped MCP preparation supports only HTTP and SSE servers.',
      );
    }

    const url = new URL(server.url);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) {
      return this.requestScopedFailure(
        options.serverId,
        'validate_server',
        'Request-scoped MCP server URL must use HTTP(S) without embedded credentials.',
      );
    }

    try {
      const discovered = await new McpClientService().listTools(
        server,
        options.signal,
        options.resolveRequestHeaders,
      );
      const record = {
        serverId: options.serverId,
        protocolVersion: discovered.protocolVersion,
        serverName: discovered.serverName,
        serverVersion: discovered.serverVersion,
        instructions: discovered.instructions,
        tools: discovered.tools,
        refreshedAt: dayjs().toISOString(),
      };
      const {
        mode: _mode,
        server: _server,
        resolveRequestHeaders,
        signal: _signal,
        ...extensionOptions
      } = options;

      return {
        ok: true,
        serverId: options.serverId,
        toolNames: record.tools.map((tool) => tool.name),
        extension: McpHostExtensionService.define({
          ...extensionOptions,
          hideDefaultMcpTools: true,
        }, {
          server,
          catalog: record,
          requestHeaders: resolveRequestHeaders,
        }),
      };
    } catch (error) {
      return this.requestScopedFailure(options.serverId, 'discover_tools', error);
    }
  }

  private static isRequestScoped(
    options: PrepareMcpHostExtensionInput,
  ): options is PrepareRequestScopedMcpHostExtensionOptions {
    return 'mode' in options && options.mode === 'request-scoped';
  }

  private static requestScopedFailure(
    serverId: string,
    step: Extract<PrepareRequestScopedMcpHostExtensionResult, { ok: false }>['step'],
    error: unknown,
  ): Extract<PrepareRequestScopedMcpHostExtensionResult, { ok: false }> {
    return {
      ok: false,
      serverId,
      step,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  private static buildConfigDocumentContent(input: {
    content: string;
    serverId: string;
    server: Record<string, unknown>;
  }): string {
    const raw = input.content.trim().length > 0
      ? JSON.parse(input.content) as unknown
      : {};
    const config = McpHostValueService.isRecord(raw) ? raw : {};
    const mcpServers = McpHostValueService.isRecord(config.mcpServers) ? config.mcpServers : {};

    return JSON.stringify({
      ...config,
      mcpServers: {
        ...mcpServers,
        [input.serverId]: input.server,
      },
    }, null, 2);
  }
}
