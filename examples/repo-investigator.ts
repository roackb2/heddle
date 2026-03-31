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
  createRunShellInspectTool,
  createRunShellMutateTool,
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
  const maxSteps = parsePositiveInt(process.env.HEDDLE_MAX_STEPS) ?? 40;

  const logger = createLogger({ pretty: true, level: 'debug' });

  logger.info({ goal, model, maxSteps }, '🧵 Heddle — Repo Investigator');

  const llm = createOpenAiAdapter({
    model,
    apiKey: process.env.OPENAI_API_KEY ?? process.env.PERSONAL_OPENAI_API_KEY,
  });
  const tools = [
    listFilesTool,
    readFileTool,
    searchFilesTool,
    reportStateTool,
    createRunShellInspectTool(),
    createRunShellMutateTool(),
  ];

  const result = await runAgent({ goal, llm, tools, maxSteps, logger });

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

function parsePositiveInt(raw: string | undefined): number | undefined {
  if (!raw) {
    return undefined;
  }

  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  return value;
}
