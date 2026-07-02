// Rung 2 — add a capability: expose an MCP server's tools to the agent.
// prepareMcpHostExtension writes MCP config/catalog under stateRoot, then
// returns a host extension you pass straight to the runner.
// Run: yarn example:sdk:add-mcp   (edit the server command for a real server)
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
