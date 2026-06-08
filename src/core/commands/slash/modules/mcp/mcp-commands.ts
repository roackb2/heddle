import { SlashCommandParser } from '../../parser.js';
import type { SlashCommandResult } from '../../result-types.js';
import type { SlashCommandModule } from '../../types.js';
import type { McpServerView } from '@/core/mcp/index.js';
import type { SlashCommandExecutionContext } from '../context.js';
import { argumentAfterPrefix, slashMessageResult } from '../results.js';

const MCP_LIST_SECTIONS: {
  status: McpServerView['status'];
  title: string;
  empty: string;
}[] = [
  { status: 'enabled', title: 'Enabled', empty: 'none' },
  { status: 'available', title: 'Available', empty: 'none' },
  { status: 'disabled', title: 'Disabled', empty: 'none' },
  { status: 'missing', title: 'Missing config', empty: 'none' },
];

export function createMcpSlashCommandModule(): SlashCommandModule<SlashCommandResult, SlashCommandExecutionContext> {
  return {
    id: 'mcp',
    hints: [
      { command: '/mcp', description: 'list MCP servers and cached tool status' },
      { command: '/mcp config', description: 'open the workspace MCP config file' },
      { command: '/mcp enable <server>', description: 'enable one configured MCP server for this workspace' },
      { command: '/mcp disable <server>', description: 'disable one MCP server for this workspace' },
      { command: '/mcp refresh <server>', description: 'connect to one enabled MCP server and refresh its cached tools' },
    ],
    commands: [
      {
        id: 'mcp.list',
        syntax: '/mcp',
        description: 'list MCP servers and cached tool status',
        match: SlashCommandParser.matchesExact('/mcp'),
        run: (context) => listMcpMessage(context),
      },
      {
        id: 'mcp.config',
        syntax: '/mcp config',
        description: 'open the workspace MCP config file',
        match: SlashCommandParser.matchesExact('/mcp config'),
        run: (context) => openMcpConfigMessage(context),
      },
      {
        id: 'mcp.enable',
        syntax: '/mcp enable <server>',
        description: 'enable one configured MCP server for this workspace',
        match: matchesRequiredMcpArgument('/mcp enable'),
        run: (context, input) => enableMcpMessage(context, argumentAfterPrefix(input, '/mcp enable')),
      },
      {
        id: 'mcp.disable',
        syntax: '/mcp disable <server>',
        description: 'disable one MCP server for this workspace',
        match: matchesRequiredMcpArgument('/mcp disable'),
        run: (context, input) => disableMcpMessage(context, argumentAfterPrefix(input, '/mcp disable')),
      },
      {
        id: 'mcp.refresh',
        syntax: '/mcp refresh <server>',
        description: 'connect to one enabled MCP server and refresh its cached tools',
        match: matchesRequiredMcpArgument('/mcp refresh'),
        run: (context, input) => refreshMcpMessage(context, argumentAfterPrefix(input, '/mcp refresh')),
      },
    ],
  };
}

export async function listMcpMessage(
  context: Pick<SlashCommandExecutionContext, 'mcp'>,
): Promise<SlashCommandResult> {
  const overview = await context.mcp.list();
  if (!overview.servers.length) {
    return slashMessageResult(`No MCP servers configured. Add servers to ${overview.configPath}.`);
  }

  return slashMessageResult([
    'MCP Servers',
    `config=${overview.configPath}`,
    '',
    ...MCP_LIST_SECTIONS.map((section) => formatMcpSection(section, overview.servers)),
    '',
    'Commands',
    '  /mcp config',
    '  /mcp enable <server>',
    '  /mcp disable <server>',
    '  /mcp refresh <server>',
  ].join('\n'));
}

async function openMcpConfigMessage(
  context: Pick<SlashCommandExecutionContext, 'mcp'>,
): Promise<SlashCommandResult> {
  const result = await context.mcp.openConfig();
  return result.ok
    ? slashMessageResult(`Opened MCP config: ${result.configPath}`)
    : slashMessageResult(`Failed to open MCP config ${result.configPath}: ${result.error}`);
}

async function enableMcpMessage(
  context: Pick<SlashCommandExecutionContext, 'mcp'>,
  value: string,
): Promise<SlashCommandResult> {
  const serverId = value.trim();
  const result = await context.mcp.enable(serverId);
  return result.ok
    ? slashMessageResult(`Enabled MCP server ${result.record.serverId}. Run /mcp refresh ${result.record.serverId} to discover tools.`)
    : slashMessageResult(`MCP server not found: ${result.serverId}`);
}

async function disableMcpMessage(
  context: Pick<SlashCommandExecutionContext, 'mcp'>,
  value: string,
): Promise<SlashCommandResult> {
  const serverId = value.trim();
  const result = await context.mcp.disable(serverId);
  return result.ok
    ? slashMessageResult(`Disabled MCP server ${result.record.serverId}. It will not be shown to future agent turns.`)
    : slashMessageResult(`MCP server is not enabled: ${result.serverId}`);
}

async function refreshMcpMessage(
  context: Pick<SlashCommandExecutionContext, 'mcp'>,
  value: string,
): Promise<SlashCommandResult> {
  const serverId = value.trim();
  const result = await context.mcp.refresh(serverId);
  return result.ok
    ? slashMessageResult(`Refreshed MCP server ${result.record.serverId}. Cached ${result.record.tools.length} tools.`)
    : slashMessageResult(`Failed to refresh MCP server ${result.serverId}: ${result.error}`);
}

function formatMcpSection(
  section: typeof MCP_LIST_SECTIONS[number],
  servers: McpServerView[],
): string {
  const sectionServers = servers.filter((server) => server.status === section.status);
  return [
    `${section.title} (${sectionServers.length})`,
    ...(sectionServers.length > 0 ? sectionServers.map(formatMcpListItem) : [`  ${section.empty}`]),
  ].join('\n');
}

function formatMcpListItem(server: McpServerView): string {
  const location = server.config?.transport === 'stdio'
    ? [server.config.command, ...server.config.args].join(' ')
    : server.config?.url;
  return [
    `- ${server.id}`,
    server.config ? `  transport=${server.config.transport}` : undefined,
    location ? `  target=${location}` : undefined,
    `  cachedTools=${server.toolCount}`,
    server.catalog?.refreshedAt ? `  refreshedAt=${server.catalog.refreshedAt}` : undefined,
    `  action=${server.action}`,
  ].filter((line): line is string => line !== undefined).join('\n');
}

function matchesRequiredMcpArgument(prefix: string): (input: { raw: string }) => boolean {
  return (input) => input.raw.startsWith(`${prefix} `) && input.raw.slice(prefix.length).trim().length > 0;
}
