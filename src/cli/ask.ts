/**
 * Ask-mode host entrypoint.
 *
 * Boundary rule:
 * session-backed ask uses createConversationEngine(...).sessions and
 * createConversationEngine(...).turns. Keep CLI flag parsing, daemon attach
 * routing, output formatting, and stateless ask behavior in this host file.
 *
 * Current compromise:
 * stateless ask still calls runAgentLoop and owns trace/memory-maintenance
 * output directly. The desired shape is a core one-shot execution service that
 * ask mode can call while this file remains a CLI adapter.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  appendMemoryCatalogSystemContext,
  DEFAULT_OPENAI_MODEL,
  type ToolCall,
  type ToolDefinition,
  type TraceEvent,
  createLlmAdapter,
  inferProviderFromModel,
  runAgentLoop,
  formatTraceForConsole,
  createLogger,
  hasProviderCredentialForModel,
  resolveApiKeyForModel,
} from '../index.js';
import { runMaintenanceForRecordedCandidates } from '../core/memory/maintenance-integration.js';
import type { ResolvedRuntimeHost } from '../core/runtime/runtime-hosts.js';
import { createConversationEngine } from '../core/chat/engine/index.js';
import type { ConversationEngine } from '../core/chat/engine/index.js';
import type { ChatSession } from '../core/chat/types.js';
import { resolveWorkspaceContext } from '../core/runtime/workspaces.js';
import { createDaemonControlPlaneClient } from './remote/control-plane-client.js';

export type AskCliOptions = {
  model?: string;
  maxSteps?: number;
  apiKey?: string;
  preferApiKey?: boolean;
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
      preferApiKey: options.preferApiKey,
      searchIgnoreDirs: options.searchIgnoreDirs,
      systemContext: options.systemContext,
      targetSessionId: options.sessionId,
      latestSession: options.latestSession,
      createSessionName: options.createSessionName,
      runtimeHost: options.runtimeHost,
    });
    return;
  }

  const apiKeyPresent = hasProviderCredentialForModel(model, {
    apiKey: options.apiKey,
    apiKeyProvider: 'explicit',
    preferApiKey: options.preferApiKey,
  });
  const askSessionEngine = createConversationEngine({
    workspaceRoot,
    stateRoot,
    sessionStoragePath,
    model,
    apiKey: options.apiKey,
    preferApiKey: options.preferApiKey,
    systemContext,
    memoryMaintenanceMode: 'inline',
    apiKeyPresent,
  });
  const targetSession = resolveAskSession({
    engine: askSessionEngine,
    workspaceRoot,
    sessionId: options.sessionId,
    latestSession: options.latestSession,
    createSessionName: options.createSessionName,
    stateRoot,
    model,
    apiKeyPresent,
  });

  if (targetSession) {
    const approvalHandler = createEvalAutoApprovalHandler();
    const result = await askSessionEngine.turns.submit({
      sessionId: targetSession.id,
      prompt: goal,
      memoryMaintenanceMode: 'inline',
      host: approvalHandler ? {
        approvals: {
          requestToolApproval: async ({ call, tool }) => {
            return await approvalHandler(call, tool);
          },
        },
      } : undefined,
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

  // Desired shape: stateless ask should call a core one-shot execution service
  // instead of locally composing LLM setup, runAgentLoop, memory maintenance,
  // trace persistence, and console formatting in the CLI host.
  const apiKey = resolveApiKeyForModel(model, {
    apiKey: options.apiKey,
    apiKeyProvider: options.apiKey ? 'explicit' : undefined,
    preferApiKey: options.preferApiKey,
  });
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
    approveToolCall: createEvalAutoApprovalHandler(),
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

function createEvalAutoApprovalHandler():
  | ((call: ToolCall, tool: ToolDefinition) => Promise<{ approved: boolean; reason?: string }>)
  | undefined {
  if (process.env.HEDDLE_EVAL_AUTO_APPROVE !== '1') {
    return undefined;
  }

  return async (call, _tool) => ({
    approved: true,
    reason: `Approved by Heddle eval harness for disposable workspace execution (${call.tool}).`,
  });
}

async function runDaemonBackedAsk(options: {
  goal: string;
  model: string;
  maxSteps: number;
  apiKey?: string;
  preferApiKey?: boolean;
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

  // Daemon-backed session ask is already routed through the control-plane
  // controller. Remaining cleanup here is presentation-level: share result
  // formatting with local session-backed ask instead of hand-building the same
  // summary lines in two places.
  if (options.targetSessionId || options.latestSession || options.createSessionName !== undefined) {
    const sessionId =
      options.targetSessionId
      ?? (options.latestSession ? await resolveLatestRemoteSessionId(client) : undefined)
      ?? await createRemoteSession(client, {
        name: options.createSessionName?.trim() || undefined,
        model: options.model,
        apiKeyPresent: hasProviderCredentialForModel(options.model, {
          apiKey: options.apiKey,
          apiKeyProvider: 'explicit',
          preferApiKey: options.preferApiKey,
        }),
      });

    const result = await client.controlPlane.sessionSendPrompt.mutate({
      sessionId,
      prompt: options.goal,
      apiKey: options.apiKey,
      preferApiKey: options.preferApiKey,
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
    preferApiKey: options.preferApiKey,
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
  engine: ConversationEngine;
  workspaceRoot: string;
  sessionId?: string;
  latestSession?: boolean;
  createSessionName?: string;
  stateRoot: string;
  model: string;
  apiKeyPresent: boolean;
}): ChatSession | undefined {
  if (options.createSessionName !== undefined) {
    const workspace = resolveWorkspaceContext({
      workspaceRoot: options.workspaceRoot,
      stateRoot: options.stateRoot,
    }).activeWorkspace;
    return options.engine.sessions.create({
      name: options.createSessionName.trim() || undefined,
      apiKeyPresent: options.apiKeyPresent,
      model: options.model,
      workspaceId: workspace.id,
    });
  }

  if (options.latestSession) {
    const latest = options.engine.sessions.listExisting()[0];
    if (!latest) {
      throw new Error('No saved chat sessions are available yet. Use --new-session to create one first.');
    }
    return latest;
  }

  if (options.sessionId) {
    return options.engine.sessions.require(options.sessionId);
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
