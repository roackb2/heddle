/**
 * Ask-mode host entrypoint.
 *
 * Boundary rule:
 * session-backed ask uses createConversationEngine(...).sessions and
 * createConversationEngine(...).turns. Keep CLI flag parsing, daemon attach
 * routing, and output formatting in this host file.
 *
 * Ask without an explicit session is still session-backed: it creates a
 * persisted one-off session so local and daemon ask modes share turn execution,
 * trace persistence, memory maintenance, and future capability options.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  appendMemoryCatalogSystemContext,
  DEFAULT_OPENAI_MODEL,
  type ToolCall,
  type ToolDefinition,
  type TraceEvent,
  inferProviderFromModel,
  formatTraceForConsole,
  createLogger,
  RuntimeCredentialService,
} from '../index.js';
import type { ResolvedRuntimeHost } from '@/core/runtime/daemon/index.js';
import { createConversationEngine } from '../core/chat/engine/index.js';
import type { ConversationEngine } from '../core/chat/engine/index.js';
import type { ChatSession, ChatSessionRetention } from '../core/chat/types.js';
import { RuntimeWorkspaceService } from '@/core/runtime/workspaces/index.js';
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

type RunDaemonBackedAskOptions = {
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
};

export class AskCliHost {
  static async run(goal: string, options: AskCliOptions = {}) {
    if (!goal.trim()) {
      throw new Error('Usage: heddle ask "<goal>"');
    }

    const model = options.model ?? process.env.OPENAI_MODEL ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_OPENAI_MODEL;
    const maxSteps = options.maxSteps ?? AskCliHost.parsePositiveInt(process.env.HEDDLE_MAX_STEPS) ?? 100;
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
      await AskCliHost.runDaemonBackedAsk({
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

    const apiKeyPresent = RuntimeCredentialService.hasCredentialForModel(model, {
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
    const targetSession = AskCliHost.resolveAskSession({
      engine: askSessionEngine,
      workspaceRoot,
      sessionId: options.sessionId,
      latestSession: options.latestSession,
      createSessionName: options.createSessionName,
      stateRoot,
      model,
      apiKeyPresent,
    });

    const approvalHandler = AskCliHost.createEvalAutoApprovalHandler();
    const result = await askSessionEngine.turns.submit({
      sessionId: targetSession.id,
      prompt: goal,
      maxSteps,
      searchIgnoreDirs: options.searchIgnoreDirs,
      includePlanTool: false,
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
    const trace = latestTraceFile ? AskCliHost.readTraceFile(latestTraceFile) : undefined;
    if (trace) {
      process.stdout.write(`${formatTraceForConsole(trace)}\n`);
    }
    AskCliHost.writeAskSessionResult({
      sessionId: result.session.id,
      outcome: result.outcome,
      summary: result.summary,
      traceFile: latestTraceFile,
      latestArchivePath: result.session.context?.archive?.lastArchivePath,
    });
  }

  private static createEvalAutoApprovalHandler():
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

  private static async runDaemonBackedAsk(options: RunDaemonBackedAskOptions) {
    const client = createDaemonControlPlaneClient(options.runtimeHost);
    process.stdout.write(
      `Heddle notice: attaching ask to daemon http://${options.runtimeHost.endpoint.host}:${options.runtimeHost.endpoint.port}\n`,
    );

    const sessionId =
      options.targetSessionId
      ?? (options.latestSession ? await AskCliHost.resolveLatestRemoteSessionId(client) : undefined)
      ?? await AskCliHost.createRemoteSession(client, {
        name: options.createSessionName?.trim() || `Ask ${new Date().toISOString()}`,
        model: options.model,
        retention: options.createSessionName === undefined ? 'one_off' : 'reusable',
        apiKeyPresent: RuntimeCredentialService.hasCredentialForModel(options.model, {
          apiKey: options.apiKey,
          apiKeyProvider: 'explicit',
          preferApiKey: options.preferApiKey,
        }),
      });

    const result = await client.controlPlane.sessionSendPrompt.mutate({
      sessionId,
      prompt: options.goal,
      maxSteps: options.maxSteps,
      searchIgnoreDirs: options.searchIgnoreDirs,
      includePlanTool: false,
      apiKey: options.apiKey,
      preferApiKey: options.preferApiKey,
      systemContext: options.systemContext,
      memoryMaintenanceMode: 'inline',
    });

    AskCliHost.writeAskSessionResult({
      sessionId: result.session?.id ?? sessionId,
      outcome: result.outcome,
      summary: result.summary,
      traceFile: result.session?.turns.at(-1)?.traceFile,
      latestArchivePath: result.session?.context?.archive?.lastArchivePath,
    });
  }

  private static async resolveLatestRemoteSessionId(client: ReturnType<typeof createDaemonControlPlaneClient>): Promise<string> {
    const result = await client.controlPlane.sessions.query();
    const latest = result.sessions[0];
    if (!latest) {
      throw new Error('No saved chat sessions are available yet. Use --new-session to create one first.');
    }
    return latest.id;
  }

  private static async createRemoteSession(
    client: ReturnType<typeof createDaemonControlPlaneClient>,
    input: { name?: string; model: string; retention?: ChatSessionRetention; apiKeyPresent: boolean },
  ): Promise<string> {
    const created = await client.controlPlane.sessionCreate.mutate({
      name: input.name,
      model: input.model,
      retention: input.retention,
      apiKeyPresent: input.apiKeyPresent,
    });
    return created.id;
  }

  private static resolveAskSession(options: {
    engine: ConversationEngine;
    workspaceRoot: string;
    sessionId?: string;
    latestSession?: boolean;
    createSessionName?: string;
    stateRoot: string;
    model: string;
    apiKeyPresent: boolean;
  }): ChatSession {
    if (options.createSessionName !== undefined) {
      const workspace = RuntimeWorkspaceService.resolveContext({
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
      const latest = options.engine.sessions.latestExisting();
      if (!latest) {
        throw new Error('No saved chat sessions are available yet. Use --new-session to create one first.');
      }
      return latest;
    }

    if (options.sessionId) {
      return options.engine.sessions.require(options.sessionId);
    }

    const workspace = RuntimeWorkspaceService.resolveContext({
      workspaceRoot: options.workspaceRoot,
      stateRoot: options.stateRoot,
    }).activeWorkspace;
    return options.engine.sessions.createOneOff({
      name: `Ask ${new Date().toISOString()}`,
      apiKeyPresent: options.apiKeyPresent,
      model: options.model,
      workspaceId: workspace.id,
    });
  }

  private static readTraceFile(path: string): TraceEvent[] | undefined {
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as TraceEvent[];
    } catch {
      return undefined;
    }
  }

  private static writeAskSessionResult(result: {
    sessionId: string;
    outcome: string;
    summary: string;
    traceFile?: string;
    latestArchivePath?: string;
  }) {
    process.stdout.write(
      [
        `Session: ${result.sessionId}`,
        `Outcome: ${result.outcome}`,
        `Summary: ${result.summary}`,
        result.traceFile ? `Trace: ${result.traceFile}` : undefined,
        result.latestArchivePath ? `Latest archive: ${result.latestArchivePath}` : undefined,
      ].filter((line): line is string => Boolean(line)).join('\n') + '\n',
    );
  }

  private static parsePositiveInt(raw: string | undefined): number | undefined {
    if (!raw) {
      return undefined;
    }

    const value = Number.parseInt(raw, 10);
    if (!Number.isFinite(value) || value <= 0) {
      return undefined;
    }

    return value;
  }
}
