import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_OPENAI_MODEL,
  createLogger,
  formatTraceForConsole,
  inferProviderFromModel,
  resolveProviderApiKey,
  runAgentLoop,
  type RunResult,
} from '../../../../index.js';

export type RunControlPlaneAskArgs = {
  goal: string;
  workspaceRoot: string;
  stateRoot: string;
  model?: string;
  maxSteps?: number;
  apiKey?: string;
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
  const provider = inferProviderFromModel(model);
  const logger = createLogger({ pretty: true, level: 'debug' });

  const result = await runAgentLoop({
    goal: args.goal,
    model,
    apiKey: args.apiKey ?? resolveProviderApiKey(provider),
    maxSteps,
    logger,
    workspaceRoot: args.workspaceRoot,
    stateDir: relativeStateDir(args.workspaceRoot, args.stateRoot),
    searchIgnoreDirs: args.searchIgnoreDirs,
    systemContext: args.systemContext,
    includePlanTool: false,
  });

  const traceDir = join(args.stateRoot, 'traces');
  mkdirSync(traceDir, { recursive: true });
  const traceFile = join(traceDir, `trace-${Date.now()}.json`);
  writeFileSync(traceFile, JSON.stringify(result.trace, null, 2));

  return {
    ...result,
    traceFile,
    consoleOutput: formatTraceForConsole(result.trace),
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
