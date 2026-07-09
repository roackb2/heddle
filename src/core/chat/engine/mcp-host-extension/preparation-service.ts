import { McpService } from '@/core/mcp/index.js';
import { McpHostExtensionService } from './service.js';
import { McpHostValueService } from './value-service.js';
import type {
  PrepareMcpHostExtensionCatalogOptions,
  PrepareMcpHostExtensionCatalogResult,
  PrepareMcpHostExtensionOptions,
  PrepareMcpHostExtensionResult,
} from './types.js';

/**
 * Owns the setup lifecycle for MCP-backed host extensions.
 *
 * Preparation writes the MCP server config, activates the server, refreshes its
 * catalog, then returns the host extension definition. Runtime tool execution
 * stays in `McpHostToolDefinitionService`; this service only owns setup state.
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
