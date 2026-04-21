import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_OPENAI_MODEL,
  type TraceEvent,
  inferProviderFromModel,
  runAgentLoop,
  formatTraceForConsole,
  createLogger,
  resolveProviderApiKey,
  resolveApiKeyForModel,
} from '../index.js';
import { submitChatSessionPrompt } from '../core/chat/session-submit.js';
import type { ChatSession } from '../core/chat/types.js';
import { createChatSession, readChatSession, readChatSessionCatalog, saveChatSessions } from '../core/chat/storage.js';

export type AskCliOptions = {
  model?: string;
  maxSteps?: number;
  apiKey?: string;
  workspaceRoot?: string;
  stateDir?: string;
  searchIgnoreDirs?: string[];
  systemContext?: string;
  sessionId?: string;
  latestSession?: boolean;
  createSessionName?: string;
};

export async function runAskCli(goal: string, options: AskCliOptions = {}) {
  if (!goal.trim()) {
    throw new Error('Usage: heddle ask "<goal>"');
  }

  const model = options.model ?? process.env.OPENAI_MODEL ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_OPENAI_MODEL;
  const maxSteps = options.maxSteps ?? parsePositiveInt(process.env.HEDDLE_MAX_STEPS) ?? 100;
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  const stateRoot = join(workspaceRoot, options.stateDir ?? '.heddle');
  const logger = createLogger({ pretty: true, level: 'debug' });
  const provider = inferProviderFromModel(model);
  const sessionStoragePath = join(stateRoot, 'chat-sessions.catalog.json');

  logger.info({ goal, model, provider, maxSteps, cwd: workspaceRoot }, 'Heddle');

  const sessionModeCount = Number(Boolean(options.sessionId)) + Number(Boolean(options.latestSession)) + Number(options.createSessionName !== undefined);
  if (sessionModeCount > 1) {
    throw new Error('Choose only one of --session, --latest, or --new-session for heddle ask.');
  }

  const targetSession = resolveAskSession({
    sessionId: options.sessionId,
    latestSession: options.latestSession,
    createSessionName: options.createSessionName,
    sessionStoragePath,
    stateRoot,
    model,
    apiKeyPresent: Boolean(resolveApiKeyForModel(model, { apiKey: options.apiKey, apiKeyProvider: 'explicit' })),
  });

  if (targetSession) {
    const result = await submitChatSessionPrompt({
      workspaceRoot,
      stateRoot,
      sessionStoragePath,
      sessionId: targetSession.id,
      prompt: goal,
      apiKey: options.apiKey,
    });
    const latestTraceFile = result.session.turns.at(-1)?.traceFile;
    const trace = latestTraceFile ? readTraceFile(latestTraceFile) : undefined;
    if (trace) {
      process.stdout.write(`${formatTraceForConsole(trace)}\n`);
    }
    process.stdout.write(
      [
        `Session: ${result.session.id}`,
        `Outcome: ${result.outcome}`,
        `Summary: ${result.summary}`,
        latestTraceFile ? `Trace: ${latestTraceFile}` : undefined,
        result.session.context?.lastArchivePath ? `Latest archive: ${result.session.context.lastArchivePath}` : undefined,
      ].filter((line): line is string => Boolean(line)).join('\n') + '\n',
    );
    return;
  }

  const result = await runAgentLoop({
    goal,
    model,
    apiKey: options.apiKey ?? resolveProviderApiKey(provider),
    maxSteps,
    logger,
    workspaceRoot,
    stateDir: options.stateDir,
    searchIgnoreDirs: options.searchIgnoreDirs,
    systemContext: options.systemContext,
    includePlanTool: false,
  });
  process.stdout.write(`${formatTraceForConsole(result.trace)}\n`);

  const traceDir = join(stateRoot, 'traces');
  mkdirSync(traceDir, { recursive: true });
  const traceFile = join(traceDir, `trace-${Date.now()}.json`);
  writeFileSync(traceFile, JSON.stringify(result.trace, null, 2));
  logger.info({ traceFile }, 'Trace saved');
}

function resolveAskSession(options: {
  sessionId?: string;
  latestSession?: boolean;
  createSessionName?: string;
  sessionStoragePath: string;
  stateRoot: string;
  model: string;
  apiKeyPresent: boolean;
}): ChatSession | undefined {
  if (options.createSessionName !== undefined) {
    const existing = readChatSessionCatalog(options.sessionStoragePath);
    const nextNumber = existing.length + 1;
    const session = createChatSession({
      id: `session-${Date.now()}`,
      name: options.createSessionName.trim() || `Session ${nextNumber}`,
      apiKeyPresent: options.apiKeyPresent,
      model: options.model,
    });
    const currentSessions = existing
      .map((entry) => readChatSession(options.sessionStoragePath, entry.id, options.apiKeyPresent))
      .filter((candidate): candidate is ChatSession => Boolean(candidate));
    saveChatSessions(options.sessionStoragePath, [session, ...currentSessions]);
    return session;
  }

  if (options.latestSession) {
    const latest = readChatSessionCatalog(options.sessionStoragePath)[0];
    if (!latest) {
      throw new Error('No saved chat sessions are available yet. Use --new-session to create one first.');
    }
    const session = readChatSession(options.sessionStoragePath, latest.id, options.apiKeyPresent);
    if (!session) {
      throw new Error(`Chat session not found: ${latest.id}`);
    }
    return session;
  }

  if (options.sessionId) {
    const session = readChatSession(options.sessionStoragePath, options.sessionId, options.apiKeyPresent);
    if (!session) {
      throw new Error(`Chat session not found: ${options.sessionId}`);
    }
    return session;
  }

  return undefined;
}

function readTraceFile(path: string): TraceEvent[] | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as TraceEvent[];
  } catch {
    return undefined;
  }
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
