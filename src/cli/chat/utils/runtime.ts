import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { TraceEvent } from '../../../index.js';
import { DEFAULT_OPENAI_MODEL, inferProviderFromModel } from '../../../index.js';
import type { LlmProvider } from '../../../index.js';
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
  switch (provider) {
    case 'openai':
      return firstDefinedNonEmpty(process.env.OPENAI_API_KEY, process.env.PERSONAL_OPENAI_API_KEY);
    case 'anthropic':
      return firstDefinedNonEmpty(process.env.ANTHROPIC_API_KEY, process.env.PERSONAL_ANTHROPIC_API_KEY);
    case 'google':
      return undefined;
  }
}

export function resolveApiKeyForModel(model: string, runtime?: Pick<ChatRuntimeConfig, 'apiKey' | 'apiKeyProvider'>): string | undefined {
  if (runtime?.apiKey && runtime.apiKeyProvider === 'explicit') {
    return runtime.apiKey;
  }

  const provider = inferProviderFromModel(model);
  if (runtime?.apiKey && runtime.apiKeyProvider === provider) {
    return runtime.apiKey;
  }

  return resolveProviderApiKey(provider);
}

function firstDefinedNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => typeof value === 'string' && value.trim().length > 0);
}
