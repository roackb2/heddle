import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_OPENAI_MODEL,
  runAgent,
  createOpenAiAdapter,
  listFilesTool,
  readFileTool,
  editFileTool,
  createSearchFilesTool,
  reportStateTool,
  createRunShellInspectTool,
  createRunShellMutateTool,
  formatTraceForConsole,
  createLogger,
} from '../index.js';

export type AskCliOptions = {
  model?: string;
  maxSteps?: number;
  apiKey?: string;
  workspaceRoot?: string;
  stateDir?: string;
  searchIgnoreDirs?: string[];
  systemContext?: string;
};

export async function runAskCli(goal: string, options: AskCliOptions = {}) {
  if (!goal.trim()) {
    throw new Error('Usage: heddle ask "<goal>"');
  }

  const model = options.model ?? process.env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL;
  const maxSteps = options.maxSteps ?? parsePositiveInt(process.env.HEDDLE_MAX_STEPS) ?? 40;
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  const stateRoot = join(workspaceRoot, options.stateDir ?? '.heddle');
  const logger = createLogger({ pretty: true, level: 'debug' });

  logger.info({ goal, model, maxSteps, cwd: workspaceRoot }, 'Heddle');

  const llm = createOpenAiAdapter({
    model,
    apiKey: options.apiKey ?? process.env.OPENAI_API_KEY ?? process.env.PERSONAL_OPENAI_API_KEY,
  });
  const tools = [
    listFilesTool,
    readFileTool,
    editFileTool,
    createSearchFilesTool({ excludedDirs: options.searchIgnoreDirs }),
    reportStateTool,
    createRunShellInspectTool(),
    createRunShellMutateTool(),
  ];

  const result = await runAgent({ goal, llm, tools, maxSteps, logger, systemContext: options.systemContext });
  process.stdout.write(`${formatTraceForConsole(result.trace)}\n`);

  const traceDir = join(stateRoot, 'traces');
  mkdirSync(traceDir, { recursive: true });
  const traceFile = join(traceDir, `trace-${Date.now()}.json`);
  writeFileSync(traceFile, JSON.stringify(result.trace, null, 2));
  logger.info({ traceFile }, 'Trace saved');
}

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
