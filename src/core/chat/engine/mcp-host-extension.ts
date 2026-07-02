import {
  McpService,
  isToolAllowed,
  shouldMcpToolRequireApproval,
} from '@/core/mcp/index.js';
import type { McpRefreshResult, McpServerConfig, McpToolDescriptor } from '@/core/mcp/index.js';
import type { ToolDefinition, ToolResult } from '@/core/types.js';
import type { ToolToolkit, ToolToolkitContext } from '@/core/tools/index.js';
import {
  defineHostExtension,
  type ConversationEngineHostArtifactOptions,
  type ConversationEngineHostExtension,
} from './host-extension.js';

export type McpHostToolOverride = {
  name?: string;
  description?: string;
  capabilities?: string[];
  requiresApproval?: boolean;
};

export type DefineMcpHostExtensionOptions = {
  id: string;
  serverId: string;
  includeTools?: string[];
  excludeTools?: string[];
  /** Prefix exposed tool names only when multiple MCP servers may collide. */
  toolNamePrefix?: string;
  defaultCapabilities?: string[];
  toolOverrides?: Record<string, McpHostToolOverride>;
  systemContext?: string;
  artifacts?: ConversationEngineHostArtifactOptions;
};

export type PrepareMcpHostExtensionCatalogOptions = {
  workspaceRoot: string;
  stateRoot: string;
  serverId: string;
  server: Record<string, unknown>;
};

export type PrepareMcpHostExtensionOptions = DefineMcpHostExtensionOptions & {
  workspaceRoot: string;
  stateRoot: string;
  server: Record<string, unknown>;
};

export type PrepareMcpHostExtensionCatalogResult =
  | {
      ok: true;
      serverId: string;
      refresh: Extract<McpRefreshResult, { ok: true }>;
      toolNames: string[];
    }
  | {
      ok: false;
      serverId: string;
      step: 'save_config' | 'activate_server' | 'refresh_catalog';
      error: string;
    };

export type PrepareMcpHostExtensionResult =
  | (Extract<PrepareMcpHostExtensionCatalogResult, { ok: true }> & {
      extension: ConversationEngineHostExtension;
    })
  | Extract<PrepareMcpHostExtensionCatalogResult, { ok: false }>;

type ResolvedMcpTool = {
  server: McpServerConfig;
  tool: McpToolDescriptor;
};

/**
 * Builds host extensions from cached MCP tool descriptors without requiring
 * programmatic hosts to copy MCP schemas into hand-written ToolDefinitions.
 */
export class McpHostExtensionService {
  static define(options: DefineMcpHostExtensionOptions): ConversationEngineHostExtension {
    const toolkit = McpHostExtensionService.createToolkit(options);

    return defineHostExtension({
      id: options.id,
      toolkits: [toolkit],
      ...(options.systemContext ? { systemContext: options.systemContext } : {}),
      ...(options.artifacts ? { artifacts: options.artifacts } : {}),
    });
  }

  private static createToolkit(options: DefineMcpHostExtensionOptions): ToolToolkit {
    return {
      id: `mcp.${options.id}`,
      createTools(context) {
        return McpHostExtensionService.resolveTools({ context, options })
          .map(({ server, tool }) => McpHostExtensionService.createTool({
            context,
            options,
            server,
            tool,
          }));
      },
    };
  }

  private static resolveTools(args: {
    context: ToolToolkitContext;
    options: DefineMcpHostExtensionOptions;
  }): ResolvedMcpTool[] {
    const mcp = McpHostExtensionService.createMcpService(args.context);
    const server = mcp.listOverview().servers.find((candidate) => candidate.id === args.options.serverId);
    if (server?.status !== 'enabled' || !server.config || !server.catalog) {
      return [];
    }

    const { config, catalog } = server;
    const include = args.options.includeTools ? new Set(args.options.includeTools) : undefined;
    const exclude = new Set(args.options.excludeTools ?? []);

    return catalog.tools
      .filter((tool) => (include ? include.has(tool.name) : true))
      .filter((tool) => !exclude.has(tool.name))
      .filter((tool) => isToolAllowed(config, tool.name))
      .map((tool) => ({
        server: config,
        tool,
      }));
  }

  private static createTool(args: {
    context: ToolToolkitContext;
    options: DefineMcpHostExtensionOptions;
    server: McpServerConfig;
    tool: McpToolDescriptor;
  }): ToolDefinition {
    const override = args.options.toolOverrides?.[args.tool.name];

    return {
      name: override?.name ?? McpHostExtensionService.toHostToolName(args.options, args.tool.name),
      requiresApproval: override?.requiresApproval ?? shouldMcpToolRequireApproval(args.server),
      description: override?.description ?? McpHostExtensionService.describeTool(args.options, args.tool),
      capabilities: override?.capabilities ?? args.options.defaultCapabilities ?? ['mcp.unknown'],
      parameters: args.tool.inputSchema,
      async execute(raw: unknown): Promise<ToolResult> {
        const result = await McpHostExtensionService.createMcpService(args.context)
          .callTool(args.options.serverId, args.tool.name, isRecord(raw) ? raw : {});

        return result.ok ? { ok: true, output: result.output } : { ok: false, error: result.error };
      },
    };
  }

  private static describeTool(options: DefineMcpHostExtensionOptions, tool: McpToolDescriptor): string {
    return tool.description ?? tool.title ?? `MCP tool "${tool.name}" from server "${options.serverId}".`;
  }

  private static toHostToolName(options: DefineMcpHostExtensionOptions, toolName: string): string {
    const normalizedToolName = normalizeToolPart(toolName);
    return options.toolNamePrefix
      ? `${normalizeToolPart(options.toolNamePrefix)}__${normalizedToolName}`
      : normalizedToolName;
  }

  private static createMcpService(context: ToolToolkitContext): McpService {
    return new McpService({
      workspaceRoot: context.workspaceRoot,
      stateRoot: context.stateRoot,
    });
  }
}

export function defineMcpHostExtension(options: DefineMcpHostExtensionOptions): ConversationEngineHostExtension {
  return McpHostExtensionService.define(options);
}

export async function prepareMcpHostExtensionCatalog(
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

  const save = mcp.saveConfigDocument(buildMcpConfigDocumentContent({
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

  return {
    ok: true,
    serverId: options.serverId,
    refresh,
    toolNames: refresh.record.tools.map((tool) => tool.name),
  };
}

export async function prepareMcpHostExtension(
  options: PrepareMcpHostExtensionOptions,
): Promise<PrepareMcpHostExtensionResult> {
  const prepared = await prepareMcpHostExtensionCatalog({
    workspaceRoot: options.workspaceRoot,
    stateRoot: options.stateRoot,
    serverId: options.serverId,
    server: options.server,
  });

  return prepared.ok
    ? {
        ...prepared,
        extension: defineMcpHostExtension(options),
      }
    : prepared;
}

function normalizeToolPart(value: string): string {
  return value.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'mcp';
}

function buildMcpConfigDocumentContent(input: {
  content: string;
  serverId: string;
  server: Record<string, unknown>;
}): string {
  const raw = input.content.trim().length > 0
    ? JSON.parse(input.content) as unknown
    : {};
  const config = isRecord(raw) ? raw : {};
  const mcpServers = isRecord(config.mcpServers) ? config.mcpServers : {};

  return JSON.stringify({
    ...config,
    mcpServers: {
      ...mcpServers,
      [input.serverId]: input.server,
    },
  }, null, 2);
}

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw);
}
