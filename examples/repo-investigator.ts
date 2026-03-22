// ---------------------------------------------------------------------------
// Example: Repo Investigator
//
// Usage:
//   OPENAI_API_KEY=sk-... npx tsx examples/repo-investigator.ts "What does this project do?"
// ---------------------------------------------------------------------------

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_OPENAI_MODEL,
  runAgent,
  createOpenAiAdapter,
  listFilesTool,
  readFileTool,
  searchFilesTool,
  reportStateTool,
  createRunShellTool,
  formatTraceForConsole,
  createLogger,
} from '../src/index.js';

async function main() {
  const goal = process.argv[2];
  if (!goal) {
    console.error('Usage: npx tsx examples/repo-investigator.ts "<goal>"');
    process.exit(1);
  }
  const model = process.env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL;

  const logger = createLogger({ pretty: true, level: 'debug' });

  logger.info({ goal, model }, '🧵 Heddle — Repo Investigator');

  const llm = createOpenAiAdapter({ model });
  const tools = [listFilesTool, readFileTool, searchFilesTool, reportStateTool, createRunShellTool()];

  const result = await runAgent({ goal, llm, tools, maxSteps: 15, logger });

  // Print formatted trace
  console.log(formatTraceForConsole(result.trace));

  // Save JSON trace
  const traceDir = join(process.cwd(), 'local', 'traces');
  mkdirSync(traceDir, { recursive: true });
  const traceFile = join(traceDir, `trace-${Date.now()}.json`);
  writeFileSync(traceFile, JSON.stringify(result.trace, null, 2));
  logger.info({ traceFile }, 'Trace saved');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
