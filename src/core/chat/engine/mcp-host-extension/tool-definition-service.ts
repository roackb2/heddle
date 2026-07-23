import {
  McpClientService,
  McpService,
  isToolAllowed,
  shouldMcpToolRequireApproval,
} from '@/core/mcp/index.js';
import { McpResultArtifactService } from './result-artifact-service.js';
import { McpHostValueService } from './value-service.js';
import type { McpCallToolResult, McpServerCatalogRecord, McpServerConfig } from '@/core/mcp/index.js';
import type { ToolDefinition, ToolExecutionContext } from '@/core/types.js';
import type { ToolToolkit, ToolToolkitContext } from '@/core/tools/index.js';
import type {
  DefineMcpHostExtensionOptions,
  ResolvedMcpHostExtensionData,
  ResolvedMcpTool,
} from './types.js';

/**
 * Owns conversion from cached MCP catalog descriptors into Heddle tools.
 *
 * Keep catalog filtering, exposed tool naming, approval defaults, and execution
 * wrapping here. Result artifact capture is delegated after the MCP call
 * succeeds so this service remains focused on tool-definition semantics.
 */
export class McpHostToolDefinitionService {
  static createToolkit(
    options: DefineMcpHostExtensionOptions,
    resolved?: ResolvedMcpHostExtensionData,
  ): ToolToolkit {
    return {
      id: `mcp.${options.id}`,
      createTools(context) {
        return McpHostToolDefinitionService.resolveTools({ context, options, resolved })
          .map(({ server, tool }) => McpHostToolDefinitionService.createTool({
            context,
            options,
            resolved,
            server,
            tool,
          }));
      },
    };
  }

  private static resolveTools(args: {
    context: ToolToolkitContext;
    options: DefineMcpHostExtensionOptions;
    resolved?: ResolvedMcpHostExtensionData;
  }): ResolvedMcpTool[] {
    const source = args.resolved
      ? { config: args.resolved.server, catalog: args.resolved.catalog }
      : McpHostToolDefinitionService.resolveFromState(args.context, args.options.serverId);
    if (!source) {
      return [];
    }

    const { config, catalog } = source;
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

  /** Read the server config + cached catalog from `stateRoot` (the CLI-host path,
   *  used when the extension was not prepared with embedded MCP data). */
  private static resolveFromState(
    context: ToolToolkitContext,
    serverId: string,
  ): { config: McpServerConfig; catalog: McpServerCatalogRecord } | undefined {
    const mcp = McpHostToolDefinitionService.createMcpService(context);
    const server = mcp.listOverview().servers.find((candidate) => candidate.id === serverId);
    if (server?.status !== 'enabled' || !server.config || !server.catalog) {
      return undefined;
    }
    return { config: server.config, catalog: server.catalog };
  }

  private static createTool(args: ResolvedMcpTool & {
    context: ToolToolkitContext;
    options: DefineMcpHostExtensionOptions;
    resolved?: ResolvedMcpHostExtensionData;
  }): ToolDefinition {
    const override = args.options.toolOverrides?.[args.tool.name];
    const name = override?.name ?? McpHostToolDefinitionService.toHostToolName(args.options, args.tool.name);

    return {
      name,
      requiresApproval: override?.requiresApproval ?? shouldMcpToolRequireApproval(args.server),
      description: override?.description ?? McpHostToolDefinitionService.describeTool(args.options, args.tool),
      capabilities: override?.capabilities ?? args.options.defaultCapabilities ?? ['mcp.unknown'],
      parameters: args.tool.inputSchema,
      async execute(raw: unknown, execution?: ToolExecutionContext) {
        const callArgs = McpHostValueService.isRecord(raw) ? raw : {};
        const result = args.resolved
          ? await McpHostToolDefinitionService.callEmbedded(
              args.resolved.server,
              args.tool.name,
              callArgs,
              execution?.signal,
            )
          : await McpHostToolDefinitionService.createMcpService(args.context)
              .callTool(args.options.serverId, args.tool.name, callArgs, execution?.signal);

        return result.ok
          ? {
              ok: true,
              output: McpResultArtifactService.apply({
                context: args.context,
                options: args.options,
                output: result.output,
                sourceTool: name,
                toolName: args.tool.name,
              }),
            }
          : { ok: false, error: result.error };
      },
    };
  }

  private static describeTool(options: DefineMcpHostExtensionOptions, tool: ResolvedMcpTool['tool']): string {
    return tool.description ?? tool.title ?? `MCP tool "${tool.name}" from server "${options.serverId}".`;
  }

  private static toHostToolName(options: DefineMcpHostExtensionOptions, toolName: string): string {
    const normalizedToolName = McpHostToolDefinitionService.normalizeToolPart(toolName);
    return options.toolNamePrefix
      ? `${McpHostToolDefinitionService.normalizeToolPart(options.toolNamePrefix)}__${normalizedToolName}`
      : normalizedToolName;
  }

  private static normalizeToolPart(value: string): string {
    return value.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'mcp';
  }

  private static createMcpService(context: ToolToolkitContext): McpService {
    return new McpService({
      workspaceRoot: context.workspaceRoot,
      stateRoot: context.stateRoot,
    });
  }

  /** Execute a tool directly from an embedded server config, without touching
   *  `stateRoot`. Mirrors the allow/deny guard `McpService.callTool` applies. */
  private static async callEmbedded(
    server: McpServerConfig,
    toolName: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<McpCallToolResult> {
    if (!isToolAllowed(server, toolName)) {
      return { ok: false, error: `MCP tool is denied by Heddle config: ${server.id}/${toolName}` };
    }
    return await new McpClientService().callTool(server, toolName, args, signal);
  }
}
