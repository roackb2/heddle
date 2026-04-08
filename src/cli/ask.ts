import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_OPENAI_MODEL,
  runAgent,
  createLlmAdapter,
  inferProviderFromModel,
  type LlmProvider,
  listFilesTool,
  readFileTool,
  editFileTool,
  createSearchFilesTool,
  createWebSearchTool,
  createViewImageTool,
  createListMemoryNotesTool,
  createReadMemoryNoteTool,
  createSearchMemoryNotesTool,
  createEditMemoryNoteTool,
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

  const model = options.model ?? process.env.OPENAI_MODEL ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_OPENAI_MODEL;
  const maxSteps = options.maxSteps ?? parsePositiveInt(process.env.HEDDLE_MAX_STEPS) ?? 40;
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  const stateRoot = join(workspaceRoot, options.stateDir ?? '.heddle');
  const logger = createLogger({ pretty: true, level: 'debug' });
  const provider = inferProviderFromModel(model);

  logger.info({ goal, model, provider, maxSteps, cwd: workspaceRoot }, 'Heddle');

  const llm = createLlmAdapter({
    model,
    apiKey: options.apiKey ?? resolveProviderApiKey(provider),
  });
  const webSearchTool = createWebSearchTool({
    model,
    provider,
    apiKey: options.apiKey ?? resolveProviderApiKey(provider),
  });
  const viewImageTool = createViewImageTool({
    model,
    provider,
    apiKey: options.apiKey ?? resolveProviderApiKey(provider),
  });
  const tools = [
    listFilesTool,
    readFileTool,
    editFileTool,
    createSearchFilesTool({ excludedDirs: options.searchIgnoreDirs }),
    webSearchTool,
    viewImageTool,
    createListMemoryNotesTool({ memoryRoot: join(stateRoot, 'memory') }),
    createReadMemoryNoteTool({ memoryRoot: join(stateRoot, 'memory') }),
    createSearchMemoryNotesTool({ memoryRoot: join(stateRoot, 'memory') }),
    createEditMemoryNoteTool({ memoryRoot: join(stateRoot, 'memory') }),
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

function resolveProviderApiKey(provider: LlmProvider): string | undefined {
  switch (provider) {
    case 'openai':
      return firstDefinedNonEmpty(process.env.OPENAI_API_KEY, process.env.PERSONAL_OPENAI_API_KEY);
    case 'anthropic':
      return firstDefinedNonEmpty(process.env.ANTHROPIC_API_KEY, process.env.PERSONAL_ANTHROPIC_API_KEY);
    case 'google':
      return undefined;
  }
}

function firstDefinedNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => typeof value === 'string' && value.trim().length > 0);
}
