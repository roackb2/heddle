/**
 * Stage 03: expose an existing MCP server as curated Heddle capabilities.
 *
 * Prerequisites: stage 01's credential setup plus a runnable MCP server.
 * Assumption: the host selects/configures MCP; Heddle prepares its tool catalog,
 * approval path, and host extension. Replace the demo command for production.
 * Run: yarn example:sdk:add-mcp
 */
import { join } from 'node:path';
import { prepareMcpHostExtension, runQuickstartConversationCli } from '../../src/index.js';

const workspaceRoot = process.cwd();
const stateRoot = join(workspaceRoot, '.heddle');

const prepared = await prepareMcpHostExtension({
  id: 'example-tools',
  workspaceRoot,
  stateRoot,
  serverId: 'example',
  server: {
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-everything'],
    cwd: workspaceRoot,
  },
  systemContext: 'Use the example MCP tools when they apply.',
});

if (!prepared.ok) {
  throw new Error(`Failed to prepare MCP host extension: ${prepared.step}: ${prepared.error}`);
}

await runQuickstartConversationCli({
  hostExtensions: [prepared.extension],
});
