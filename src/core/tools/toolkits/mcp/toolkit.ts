import {
  FileMcpActivationRepository,
  FileMcpCatalogRepository,
  FileMcpConfigRepository,
  McpService,
  isToolAllowed,
  shouldMcpToolRequireApproval,
} from '@/core/mcp/index.js';
import type { McpServerConfig, McpToolDescriptor } from '@/core/mcp/index.js';
import type { ToolDefinition, ToolExecutionContext, ToolResult } from '@/core/types.js';
import type { ToolToolkit } from '../../toolkit.js';

const MCP_LIST_TOOLS_NAME = 'mcp_list_tools';
const MCP_CALL_TOOL_NAME = 'mcp_call_tool';

export const mcpToolkit: ToolToolkit = {
  id: 'mcp',
  createTools(context) {
    const hiddenServerIds = new Set(
      (context.hiddenMcpServerIds ?? [])
        .map((serverId) => serverId.trim())
        .filter((serverId) => serverId.length > 0),
    );
    const config = new FileMcpConfigRepository({
      workspaceRoot: context.workspaceRoot,
      stateRoot: context.stateRoot,
    }).read();

    const visibleServers = config.servers.filter((server) => !hiddenServerIds.has(server.id));
    if (!visibleServers.length) {
      return [];
    }

    const catalog = new FileMcpCatalogRepository({ stateRoot: context.stateRoot }).read();
    const enabledServerIds = new Set(
      Object.values(new FileMcpActivationRepository({ stateRoot: context.stateRoot }).read().servers)
        .filter((record) => record.status === 'enabled')
        .filter((record) => !hiddenServerIds.has(record.serverId))
        .map((record) => record.serverId),
    );
    const serversById = new Map(visibleServers.map((server) => [server.id, server]));
    const discoveredTools = Object.values(catalog.servers)
      .filter((record) => enabledServerIds.has(record.serverId))
      .flatMap((record) => record.tools.map((tool) => ({
        server: serversById.get(record.serverId),
        tool,
      })))
      .filter((entry): entry is { server: McpServerConfig; tool: McpToolDescriptor } => (
        entry.server !== undefined && isToolAllowed(entry.server, entry.tool.name)
      ));

    return [
      createMcpListToolsTool({
        hiddenServerIds,
        stateRoot: context.stateRoot,
        workspaceRoot: context.workspaceRoot,
      }),
      createMcpCallToolTool({
        hiddenServerIds,
        stateRoot: context.stateRoot,
        workspaceRoot: context.workspaceRoot,
      }),
      ...discoveredTools.map(({ server, tool }) => createMcpServerTool({
        server,
        stateRoot: context.stateRoot,
        tool,
        workspaceRoot: context.workspaceRoot,
      })),
    ];
  },
};

function createMcpListToolsTool(options: {
  workspaceRoot: string;
  stateRoot: string;
  hiddenServerIds: ReadonlySet<string>;
}): ToolDefinition {
  return {
    name: MCP_LIST_TOOLS_NAME,
    description:
      'List MCP servers and cached tools enabled for this workspace. Use this before calling mcp_call_tool when you need to inspect external MCP capabilities such as Notion, Anytype, GitHub, or other configured MCP integrations. This reads Heddle MCP state only; it does not launch servers or grant permissions.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
    async execute(): Promise<ToolResult> {
      const overview = mcpService(options).listOverview();
      return {
        ok: true,
        output: {
          servers: overview.servers
            .filter((server) => !options.hiddenServerIds.has(server.id))
            .map((server) => ({
              id: server.id,
              status: server.status,
              transport: server.config?.transport,
              tools: server.catalog?.tools.map((tool) => ({
                name: tool.name,
                title: tool.title,
                description: tool.description,
                heddleToolName: server.config ? toHeddleToolName(server.id, tool.name) : undefined,
              })) ?? [],
            })),
          issues: overview.issues.filter((issue) => !isHiddenServerIssue(issue.path, options.hiddenServerIds)),
        },
      };
    },
  };
}

function createMcpCallToolTool(options: {
  workspaceRoot: string;
  stateRoot: string;
  hiddenServerIds: ReadonlySet<string>;
}): ToolDefinition {
  return {
    name: MCP_CALL_TOOL_NAME,
    requiresApproval: true,
    description:
      'Call one cached tool from an enabled MCP server by serverId and toolName. MCP tools connect Heddle to external services configured by the user, so calls are approval-gated and routed through Heddle traces.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        serverId: { type: 'string', description: 'Enabled MCP server id.' },
        toolName: { type: 'string', description: 'Original MCP tool name from mcp_list_tools.' },
        arguments: {
          type: 'object',
          description: 'Arguments matching the MCP tool input schema.',
          additionalProperties: true,
        },
      },
      required: ['serverId', 'toolName', 'arguments'],
    },
    async execute(raw: unknown, execution?: ToolExecutionContext): Promise<ToolResult> {
      if (!isMcpCallInput(raw)) {
        return { ok: false, error: 'Invalid input for mcp_call_tool. Required fields: serverId, toolName, arguments.' };
      }

      if (options.hiddenServerIds.has(raw.serverId)) {
        return { ok: false, error: `MCP server is not available through default MCP tools: ${raw.serverId}` };
      }

      const result = await mcpService(options).callTool(
        raw.serverId,
        raw.toolName,
        raw.arguments,
        execution?.signal,
      );
      return result.ok ? { ok: true, output: result.output } : { ok: false, error: result.error };
    },
  };
}

function createMcpServerTool(options: {
  workspaceRoot: string;
  stateRoot: string;
  server: McpServerConfig;
  tool: McpToolDescriptor;
}): ToolDefinition {
  return {
    name: toHeddleToolName(options.server.id, options.tool.name),
    requiresApproval: shouldMcpToolRequireApproval(options.server),
    description: [
      `MCP tool from server "${options.server.id}": ${options.tool.title ?? options.tool.name}.`,
      options.tool.description ?? 'No description provided by the MCP server.',
      'Calls external MCP capability through Heddle approval and trace boundaries.',
    ].join(' '),
    parameters: options.tool.inputSchema,
    async execute(raw: unknown, execution?: ToolExecutionContext): Promise<ToolResult> {
      const result = await mcpService(options).callTool(
        options.server.id,
        options.tool.name,
        isRecord(raw) ? raw : {},
        execution?.signal,
      );

      return result.ok ? { ok: true, output: result.output } : { ok: false, error: result.error };
    },
  };
}

function toHeddleToolName(serverId: string, toolName: string): string {
  return `mcp__${normalizeToolPart(serverId)}__${normalizeToolPart(toolName)}`;
}

function normalizeToolPart(value: string): string {
  return value.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'tool';
}

function isMcpCallInput(raw: unknown): raw is {
  serverId: string;
  toolName: string;
  arguments: Record<string, unknown>;
} {
  if (!isRecord(raw)) {
    return false;
  }

  return typeof raw.serverId === 'string'
    && raw.serverId.trim().length > 0
    && typeof raw.toolName === 'string'
    && raw.toolName.trim().length > 0
    && isRecord(raw.arguments);
}

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw);
}

function isHiddenServerIssue(path: string, hiddenServerIds: ReadonlySet<string>): boolean {
  return Array.from(hiddenServerIds).some((serverId) => path.endsWith(`#${serverId}`));
}

function mcpService(options: { workspaceRoot: string; stateRoot: string }): McpService {
  return new McpService(options);
}
