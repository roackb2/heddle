import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  appendMemoryCatalogSystemContext,
  DEFAULT_OPENAI_MODEL,
  type TraceEvent,
  createLlmAdapter,
  inferProviderFromModel,
  runAgentLoop,
  formatTraceForConsole,
  createLogger,
  hasProviderCredentialForModel,
  resolveProviderApiKey,
  resolveApiKeyForModel,
} from '../index.js';
import { runMaintenanceForRecordedCandidates } from '../core/memory/maintenance-integration.js';
import type { ResolvedRuntimeHost } from '../core/runtime/runtime-hosts.js';
import { submitChatSessionPrompt } from '../core/chat/session-submit.js';
import type { ChatSession } from '../core/chat/types.js';
import { createChatSession, readChatSession, readChatSessionCatalog, saveChatSessions } from '../core/chat/storage.js';
import { resolveWorkspaceContext } from '../core/runtime/workspaces.js';
import { createDaemonControlPlaneClient } from './remote/control-plane-client.js';

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
  runtimeHost?: ResolvedRuntimeHost;
};

export async function runAskCli(goal: string, options: AskCliOptions = {}) {
  if (!goal.trim()) {
    throw new Error('Usage: heddle ask "<goal>"');
  }

  const model = options.model ?? process.env.OPENAI_MODEL ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_OPENAI_MODEL;
  const maxSteps = options.maxSteps ?? parsePositiveInt(process.env.HEDDLE_MAX_STEPS) ?? 100;
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  const stateRoot = join(workspaceRoot, options.stateDir ?? '.heddle');
  const systemContext = appendMemoryCatalogSystemContext({
    systemContext: options.systemContext,
    memoryRoot: join(stateRoot, 'memory'),
  });
  const logger = createLogger({ pretty: true, level: 'debug' });
  const provider = inferProviderFromModel(model);
  const sessionStoragePath = join(stateRoot, 'chat-sessions.catalog.json');

  logger.info({ goal, model, provider, maxSteps, cwd: workspaceRoot }, 'Heddle');

  const sessionModeCount = Number(Boolean(options.sessionId)) + Number(Boolean(options.latestSession)) + Number(options.createSessionName !== undefined);
  if (sessionModeCount > 1) {
    throw new Error('Choose only one of --session, --latest, or --new-session for heddle ask.');
  }

  if (options.runtimeHost?.kind === 'daemon' && !options.runtimeHost.stale) {
    await runDaemonBackedAsk({
      goal,
      model,
      maxSteps,
      apiKey: options.apiKey,
      searchIgnoreDirs: options.searchIgnoreDirs,
      systemContext: options.systemContext,
      targetSessionId: options.sessionId,
      latestSession: options.latestSession,
      createSessionName: options.createSessionName,
      runtimeHost: options.runtimeHost,
    });
    return;
  }

  const targetSession = resolveAskSession({
    workspaceRoot,
    sessionId: options.sessionId,
    latestSession: options.latestSession,
    createSessionName: options.createSessionName,
    sessionStoragePath,
    stateRoot,
    model,
    apiKeyPresent: hasProviderCredentialForModel(model, { apiKey: options.apiKey, apiKeyProvider: 'explicit' }),
  });

  if (targetSession) {
    const result = await submitChatSessionPrompt({
      workspaceRoot,
      stateRoot,
      sessionStoragePath,
      sessionId: targetSession.id,
      prompt: goal,
      apiKey: options.apiKey,
      systemContext,
      memoryMaintenanceMode: 'inline',
      leaseOwner: {
        ownerKind: 'ask',
        ownerId: `ask-${process.pid}`,
        clientLabel: 'heddle ask',
      },
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

  const apiKey = options.apiKey ?? resolveProviderApiKey(provider);
  const llm = createLlmAdapter({ model, apiKey });
  const memoryDir = join(stateRoot, 'memory');
  const result = await runAgentLoop({
    goal,
    model,
    apiKey,
    maxSteps,
    logger,
    workspaceRoot,
    stateDir: options.stateDir,
    memoryDir,
    searchIgnoreDirs: options.searchIgnoreDirs,
    systemContext,
    includePlanTool: false,
    llm,
  });
  const maintenance = await runMaintenanceForRecordedCandidates({
    memoryRoot: memoryDir,
    llm,
    source: 'heddle ask',
    trace: result.trace,
    maxSteps: 20,
  });
  const trace = maintenance.events.length > 0 ? [...result.trace, ...maintenance.events] : result.trace;
  process.stdout.write(`${formatTraceForConsole(trace)}\n`);

  const traceDir = join(stateRoot, 'traces');
  mkdirSync(traceDir, { recursive: true });
  const traceFile = join(traceDir, `trace-${Date.now()}.json`);
  writeFileSync(traceFile, JSON.stringify(trace, null, 2));
  logger.info({ traceFile }, 'Trace saved');
}

async function runDaemonBackedAsk(options: {
  goal: string;
  model: string;
  maxSteps: number;
  apiKey?: string;
  searchIgnoreDirs?: string[];
  systemContext?: string;
  targetSessionId?: string;
  latestSession?: boolean;
  createSessionName?: string;
  runtimeHost: Extract<ResolvedRuntimeHost, { kind: 'daemon' }>;
}) {
  const client = createDaemonControlPlaneClient(options.runtimeHost);
  process.stdout.write(
    `Heddle notice: attaching ask to daemon http://${options.runtimeHost.endpoint.host}:${options.runtimeHost.endpoint.port}\n`,
  );

  if (options.targetSessionId || options.latestSession || options.createSessionName !== undefined) {
    const sessionId =
      options.targetSessionId
      ?? (options.latestSession ? await resolveLatestRemoteSessionId(client) : undefined)
      ?? await createRemoteSession(client, {
        name: options.createSessionName?.trim() || undefined,
        model: options.model,
        apiKeyPresent: hasProviderCredentialForModel(options.model, { apiKey: options.apiKey, apiKeyProvider: 'explicit' }),
      });

    const result = await client.controlPlane.sessionSendPrompt.mutate({
      sessionId,
      prompt: options.goal,
      apiKey: options.apiKey,
      systemContext: options.systemContext,
      memoryMaintenanceMode: 'inline',
    });

    process.stdout.write(
      [
        `Session: ${result.session?.id ?? sessionId}`,
        `Outcome: ${result.outcome}`,
        `Summary: ${result.summary}`,
        result.session?.turns.at(-1)?.traceFile ? `Trace: ${result.session.turns.at(-1)?.traceFile}` : undefined,
        result.session?.context?.lastArchivePath ? `Latest archive: ${result.session.context.lastArchivePath}` : undefined,
      ].filter((line): line is string => Boolean(line)).join('\n') + '\n',
    );
    return;
  }

  const result = await client.controlPlane.agentAsk.mutate({
    goal: options.goal,
    model: options.model,
    maxSteps: options.maxSteps,
    apiKey: options.apiKey,
    searchIgnoreDirs: options.searchIgnoreDirs,
    systemContext: options.systemContext,
  });

  process.stdout.write(`${result.consoleOutput}\n`);
  process.stdout.write(`Trace: ${result.traceFile}\n`);
}

async function resolveLatestRemoteSessionId(client: ReturnType<typeof createDaemonControlPlaneClient>): Promise<string> {
  const result = await client.controlPlane.sessions.query();
  const latest = result.sessions[0];
  if (!latest) {
    throw new Error('No saved chat sessions are available yet. Use --new-session to create one first.');
  }
  return latest.id;
}

async function createRemoteSession(
  client: ReturnType<typeof createDaemonControlPlaneClient>,
  input: { name?: string; model: string; apiKeyPresent: boolean },
): Promise<string> {
  const created = await client.controlPlane.sessionCreate.mutate({
    name: input.name,
    model: input.model,
    apiKeyPresent: input.apiKeyPresent,
  });
  return created.id;
}

function resolveAskSession(options: {
  workspaceRoot: string;
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
    const workspace = resolveWorkspaceContext({
      workspaceRoot: options.workspaceRoot,
      stateRoot: options.stateRoot,
    }).activeWorkspace;
    const session = createChatSession({
      id: `session-${Date.now()}`,
      name: options.createSessionName.trim() || `Session ${nextNumber}`,
      apiKeyPresent: options.apiKeyPresent,
      model: options.model,
      workspaceId: workspace.id,
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
