import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { TraceEvent } from '../index.js';
import { DEFAULT_OPENAI_MODEL } from '../index.js';
import { parsePositiveInt } from './chat-format.js';

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
  logFile: string;
  sessionsFile: string;
  traceDir: string;
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
  return {
    model: options.model ?? process.env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL,
    maxSteps: options.maxSteps ?? parsePositiveInt(process.env.HEDDLE_MAX_STEPS) ?? 40,
    apiKey: options.apiKey ?? process.env.OPENAI_API_KEY ?? process.env.PERSONAL_OPENAI_API_KEY,
    workspaceRoot,
    logFile: join(stateRoot, 'logs', `${sessionId}.log`),
    sessionsFile: join(stateRoot, 'chat-sessions.json'),
    traceDir: join(stateRoot, 'traces'),
    directShellApproval: options.directShellApproval ?? 'never',
    searchIgnoreDirs: options.searchIgnoreDirs ?? [],
    systemContext: options.systemContext,
  };
}
