// ---------------------------------------------------------------------------
// Example: Heartbeat
//
// Usage:
//   OPENAI_API_KEY=sk-... yarn example:heartbeat
//
// Optional:
//   HEDDLE_EXAMPLE_MODEL=claude-3-5-haiku-latest ANTHROPIC_API_KEY=sk-ant-... yarn example:heartbeat
//
// This demonstrates one scheduler-style heartbeat wake cycle. It loads a local
// checkpoint if one exists, wakes the agent without a chat message, lets it work
// within a small step budget, then persists the next checkpoint.
// ---------------------------------------------------------------------------

import { join } from 'node:path';
import { inferProviderFromModel } from '../src/llm/providers.js';
import { resolveProviderApiKey } from '../src/runtime/api-keys.js';
import { createFileHeartbeatCheckpointStore, runStoredHeartbeat } from '../src/runtime/heartbeat-store.js';

const DEFAULT_EXAMPLE_MODEL = 'gpt-5.1-codex-mini';
const CHECKPOINT_PATH = join(process.cwd(), '.heddle', 'examples', 'heartbeat-demo-checkpoint.json');

async function main() {
  const model = process.env.HEDDLE_EXAMPLE_MODEL ?? process.env.OPENAI_MODEL ?? DEFAULT_EXAMPLE_MODEL;
  const provider = inferProviderFromModel(model);
  const apiKey = resolveProviderApiKey(provider);
  if (!apiKey) {
    throw new Error(
      `Missing API key for ${provider}. ` +
      'Set OPENAI_API_KEY for OpenAI models or ANTHROPIC_API_KEY for Claude models before running this example.',
    );
  }

  const store = createFileHeartbeatCheckpointStore({ path: CHECKPOINT_PATH });
  const result = await runStoredHeartbeat({
    store,
    task:
      'Check whether there is useful autonomous work to do for this demo. No tools are available in this demo wake cycle. If no external task is available, explain that this wake cycle should pause.',
    model,
    apiKey,
    tools: [],
    includeDefaultTools: false,
    workspaceRoot: process.cwd(),
    onEvent(event) {
      if (event.type === 'loop.started') {
        console.log(`[event] heartbeat.started model=${event.model} provider=${event.provider}`);
      }
      if (event.type === 'trace' && event.event.type === 'tool.call') {
        console.log(`[trace] tool.call step=${event.event.step} tool=${event.event.call.tool}`);
      }
      if (event.type === 'loop.finished') {
        console.log(`[event] heartbeat.finished outcome=${event.outcome} trace=${event.state.trace.length}`);
      }
    },
  });

  console.log('\nHeartbeat result:\n');
  console.log(`loadedCheckpoint=${result.loadedCheckpoint}`);
  console.log(`decision=${result.decision}`);
  console.log(`nextDelayMs=${result.nextDelayMs ?? 'none'}`);
  console.log(`summary=${result.summary}`);
  console.log(`checkpoint=${CHECKPOINT_PATH}`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
