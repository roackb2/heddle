/**
 * Stage 04: keep Heddle's conversation engine and replace presentation.
 *
 * Prerequisite: stage 01's credential setup.
 * Assumption: one process owns the turn while the host owns the output sink.
 * Shows: the boundary to use for a custom terminal, webhook, log sink, or local
 * application view before adding addressable/reconnectable run lifecycle.
 * Run: yarn example:sdk:custom-output
 */
import { join } from 'node:path';
import { createConversationEngine, createConversationTextHost } from '../../src/index.js';

const workspaceRoot = process.cwd();
const stateRoot = join(workspaceRoot, '.heddle');

const engine = createConversationEngine({
  workspaceRoot,
  stateRoot,
  model: process.env.HEDDLE_MODEL ?? 'gpt-5.4',
});

const session = await engine.sessions.create({ name: 'Custom output example' });

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
