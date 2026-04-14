import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { TraceEvent } from '../../../index.js';
import { DEFAULT_OPENAI_MODEL, inferProviderFromModel } from '../../../index.js';
import type { LlmProvider } from '../../../index.js';
import { resolveApiKeyForModel as resolveRuntimeApiKeyForModel, resolveProviderApiKey as resolveRuntimeProviderApiKey } from '../../../runtime/api-keys.js';
import { parsePositiveInt } from './format.js';

export type ChatCliOptions = {
  model?: string;
  maxSteps?: number;
  apiKey?: string;
  workspaceRoot?: string;
  stateDir?: string;
  directShellApproval?: 'always' | 'never';
  searchIgnoreDirs?: string[];
  systemContext?: string;
};

export type ChatRuntimeConfig = {
  model: string;
  maxSteps: number;
  apiKey?: string;
  apiKeyProvider?: LlmProvider | 'explicit';
  stateRoot: string;
  logFile: string;
  sessionsFile: string;
  approvalsFile: string;
  traceDir: string;
  memoryDir: string;
  workspaceRoot: string;
  directShellApproval: 'always' | 'never';
  searchIgnoreDirs: string[];
  systemContext?: string;
};

export function saveTrace(traceDir: string, trace: TraceEvent[]): string {
  mkdirSync(traceDir, { recursive: true });
  const traceFile = join(traceDir, `trace-${Date.now()}.json`);
  writeFileSync(traceFile, JSON.stringify(trace, null, 2));
  return traceFile;
}

export function resolveChatRuntimeConfig(options: ChatCliOptions): ChatRuntimeConfig {
  const workspaceRoot = resolve(options.workspaceRoot ?? process.cwd());
  const sessionId = `chat-${Date.now()}`;
  const stateRoot = resolve(workspaceRoot, options.stateDir ?? '.heddle');
  const model = options.model ?? process.env.OPENAI_MODEL ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_OPENAI_MODEL;
  const provider = inferProviderFromModel(model);
  const apiKey = options.apiKey ?? resolveProviderApiKey(provider);

  return {
    model,
    maxSteps: options.maxSteps ?? parsePositiveInt(process.env.HEDDLE_MAX_STEPS) ?? 40,
    apiKey,
    apiKeyProvider: options.apiKey ? 'explicit' : apiKey ? provider : undefined,
    workspaceRoot,
    stateRoot,
    logFile: join(stateRoot, 'logs', `${sessionId}.log`),
    sessionsFile: join(stateRoot, 'chat-sessions.json'),
    approvalsFile: join(stateRoot, 'command-approvals.json'),
    traceDir: join(stateRoot, 'traces'),
    memoryDir: join(stateRoot, 'memory'),
    directShellApproval: options.directShellApproval ?? 'never',
    searchIgnoreDirs: options.searchIgnoreDirs ?? [],
    systemContext: options.systemContext,
  };
}

export function resolveProviderApiKey(provider: LlmProvider): string | undefined {
  return resolveRuntimeProviderApiKey(provider);
}

export function resolveApiKeyForModel(model: string, runtime?: Pick<ChatRuntimeConfig, 'apiKey' | 'apiKeyProvider'>): string | undefined {
  return resolveRuntimeApiKeyForModel(model, runtime);
}
