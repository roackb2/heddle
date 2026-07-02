import { runConversationCli } from '../../src/index.js';

await runConversationCli({
  model: process.env.HEDDLE_EXAMPLE_MODEL ?? 'gpt-5.1-codex-mini',
});
