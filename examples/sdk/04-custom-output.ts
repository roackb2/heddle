// Rung 3 — shape input/output: drive the engine directly and send streaming
// text to your own destination instead of the default terminal writer.
// Run: yarn example:sdk:custom-output
import { join } from 'node:path';
import { createConversationEngine, createConversationTextHost } from '../../src/index.js';

const workspaceRoot = process.cwd();
const stateRoot = join(workspaceRoot, '.heddle');

const engine = createConversationEngine({
  workspaceRoot,
  stateRoot,
  model: process.env.HEDDLE_MODEL ?? 'gpt-5.4',
});

const session = engine.sessions.create({ name: 'Custom output example' });

// The text host owns streaming/status/result formatting; `output` is the sink.
// Swap this for a web transport, chat webhook, or log collector.
const textHost = createConversationTextHost({
  output: (text) => process.stdout.write(`[agent] ${text}`),
});

const result = await engine.turns.submit({
  sessionId: session.id,
  prompt: 'Introduce yourself in one sentence, then stop.',
  host: textHost.host,
});

textHost.renderTurnResult(result);
