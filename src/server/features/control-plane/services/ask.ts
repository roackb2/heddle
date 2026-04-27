import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  appendMemoryCatalogSystemContext,
  DEFAULT_OPENAI_MODEL,
  createLlmAdapter,
  createLogger,
  formatTraceForConsole,
  resolveApiKeyForModel,
  runAgentLoop,
  type RunResult,
} from '../../../../index.js';
import { runMaintenanceForRecordedCandidates } from '../../../../core/memory/maintenance-integration.js';

export type RunControlPlaneAskArgs = {
  goal: string;
  workspaceRoot: string;
  stateRoot: string;
  model?: string;
  maxSteps?: number;
  apiKey?: string;
  preferApiKey?: boolean;
  searchIgnoreDirs?: string[];
  systemContext?: string;
};

export type ControlPlaneAskResult = Pick<RunResult, 'outcome' | 'summary' | 'trace' | 'transcript'> & {
  traceFile: string;
  consoleOutput: string;
};

export async function runControlPlaneAsk(args: RunControlPlaneAskArgs): Promise<ControlPlaneAskResult> {
  const model = args.model ?? process.env.OPENAI_MODEL ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_OPENAI_MODEL;
  const maxSteps = args.maxSteps ?? parsePositiveInt(process.env.HEDDLE_MAX_STEPS) ?? 100;
  const logger = createLogger({ pretty: true, level: 'debug' });
  const memoryDir = join(args.stateRoot, 'memory');
  const apiKey = resolveApiKeyForModel(model, {
    apiKey: args.apiKey,
    apiKeyProvider: args.apiKey ? 'explicit' : undefined,
    preferApiKey: args.preferApiKey,
  });
  const llm = createLlmAdapter({ model, apiKey });

  const result = await runAgentLoop({
    goal: args.goal,
    model,
    apiKey,
    maxSteps,
    logger,
    workspaceRoot: args.workspaceRoot,
    stateDir: relativeStateDir(args.workspaceRoot, args.stateRoot),
    searchIgnoreDirs: args.searchIgnoreDirs,
    memoryDir,
    systemContext: appendMemoryCatalogSystemContext({
      systemContext: args.systemContext,
      memoryRoot: memoryDir,
    }),
    includePlanTool: false,
    llm,
  });
  const maintenance = await runMaintenanceForRecordedCandidates({
    memoryRoot: memoryDir,
    llm,
    source: 'control plane ask',
    trace: result.trace,
    maxSteps: 20,
  });
  const trace = maintenance.events.length > 0 ? [...result.trace, ...maintenance.events] : result.trace;

  const traceDir = join(args.stateRoot, 'traces');
  mkdirSync(traceDir, { recursive: true });
  const traceFile = join(traceDir, `trace-${Date.now()}.json`);
  writeFileSync(traceFile, JSON.stringify(trace, null, 2));

  return {
    ...result,
    trace,
    traceFile,
    consoleOutput: formatTraceForConsole(trace),
  };
}

function relativeStateDir(workspaceRoot: string, stateRoot: string): string | undefined {
  if (!stateRoot.startsWith(workspaceRoot)) {
    return undefined;
  }
  const suffix = stateRoot.slice(workspaceRoot.length).replace(/^\/+/, '');
  return suffix || '.heddle';
}

function parsePositiveInt(raw: string | undefined): number | undefined {
  if (!raw) {
    return undefined;
  }

  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}
