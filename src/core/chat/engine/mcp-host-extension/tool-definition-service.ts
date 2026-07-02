import {
  McpService,
  isToolAllowed,
  shouldMcpToolRequireApproval,
} from '@/core/mcp/index.js';
import { McpResultArtifactService } from './result-artifact-service.js';
import { McpHostValueService } from './value-service.js';
import type { ToolDefinition } from '@/core/types.js';
import type { ToolToolkit, ToolToolkitContext } from '@/core/tools/index.js';
import type {
  DefineMcpHostExtensionOptions,
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
  static createToolkit(options: DefineMcpHostExtensionOptions): ToolToolkit {
    return {
      id: `mcp.${options.id}`,
      createTools(context) {
        return McpHostToolDefinitionService.resolveTools({ context, options })
          .map(({ server, tool }) => McpHostToolDefinitionService.createTool({
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
    const mcp = McpHostToolDefinitionService.createMcpService(args.context);
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

  private static createTool(args: ResolvedMcpTool & {
    context: ToolToolkitContext;
    options: DefineMcpHostExtensionOptions;
  }): ToolDefinition {
    const override = args.options.toolOverrides?.[args.tool.name];
    const name = override?.name ?? McpHostToolDefinitionService.toHostToolName(args.options, args.tool.name);

    return {
      name,
      requiresApproval: override?.requiresApproval ?? shouldMcpToolRequireApproval(args.server),
      description: override?.description ?? McpHostToolDefinitionService.describeTool(args.options, args.tool),
      capabilities: override?.capabilities ?? args.options.defaultCapabilities ?? ['mcp.unknown'],
      parameters: args.tool.inputSchema,
      async execute(raw: unknown) {
        const result = await McpHostToolDefinitionService.createMcpService(args.context)
          .callTool(args.options.serverId, args.tool.name, McpHostValueService.isRecord(raw) ? raw : {});

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
}
