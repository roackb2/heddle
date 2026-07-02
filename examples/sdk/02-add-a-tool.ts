// Rung 2 — add a capability: hand the agent one of your own tools.
// Run: yarn example:sdk:add-tool
import { runQuickstartConversationCli, type ToolDefinition } from '../../src/index.js';

const currentTimeTool: ToolDefinition = {
  name: 'current_time',
  description: 'Return the current time as an ISO-8601 timestamp.',
  parameters: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  execute: async () => ({ ok: true, output: new Date().toISOString() }),
};

await runQuickstartConversationCli({
  tools: [currentTimeTool],
  systemContext: 'Use the current_time tool when the user asks about the time.',
});
