/**
 * Control-plane chat session application service.
 *
 * Boundary rule:
 * ordinary create/read/update/submit/continue flows go through
 * createConversationEngine(...). The controller owns daemon/control-plane
 * orchestration only: event fanout, pending approval state, cancellation, and
 * DTO projection.
 *
 * Current compromise:
 * the fake E2E shortcut below still mutates file-backed session storage
 * directly. Keep that path isolated until test fakes can be injected through
 * the engine turn boundary.
 */
import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { readChatSession, readChatSessionCatalog, saveChatSessions } from '../../../../core/chat/engine/sessions/repository/file-chat-session-repository.js';
import { createConversationEngine } from '../../../../core/chat/engine/conversation-engine.js';
import type {
  ConversationEngine,
  ConversationEngineConfig,
  ConversationEngineHost,
  UpdateConversationSessionSettingsInput,
} from '../../../../core/chat/engine/types.js';
import { DEFAULT_OPENAI_MODEL } from '../../../../core/config.js';
import { credentialModeFromSource, resolveCompatibleActiveModel } from '../../../../core/llm/model-policy.js';
import { inferProviderFromModel } from '../../../../core/llm/providers.js';
import { hasProviderCredentialForModel, resolveProviderCredentialSourceForModel } from '../../../../core/runtime/api-keys.js';
import type { ChatSessionLeaseOwner } from '../../../../core/chat/engine/sessions/lease.js';
import type { ChatSession, TurnSummary } from '../../../../core/chat/types.js';
import { buildConversationMessages } from '../../../../core/chat/engine/sessions/conversation-lines.js';
import { requestToolApproval } from '../../../../core/approvals/surface.js';
import type { ToolCall, ToolDefinition } from '../../../../core/types.js';
import { ControlPlaneChatSessionEventsController } from './chat-session-events.js';
import { ControlPlaneChatSessionPresenter } from './chat-session-presenter.js';
import { ControlPlaneChatTurnReviewPresenter } from './chat-turn-review-presenter.js';
import type {
  ChatSessionDetail,
  ChatSessionView,
  ChatTurnReview,
  ControlPlanePendingApproval,
  ControlPlaneSessionLiveEvent,
} from '../types.js';

type ControlPlaneSessionReadArgs = Omit<ConversationEngineConfig, 'model'> & {
  model?: string;
  sessionStoragePath: string;
};

type CreateControlPlaneChatSessionArgs = ControlPlaneSessionReadArgs & {
  suggestedName?: string;
  retention?: ChatSession['retention'];
};

type UpdateControlPlaneChatSessionSettingsArgs = ControlPlaneSessionReadArgs & {
  sessionId: string;
  settings: UpdateConversationSessionSettingsInput;
};

type SubmitChatPromptArgs = ControlPlaneSessionReadArgs & {
  sessionId: string;
  prompt: string;
  maxSteps?: number;
  searchIgnoreDirs?: string[];
  includePlanTool?: boolean;
  leaseOwner: ChatSessionLeaseOwner;
};

type ContinueChatPromptArgs = Omit<SubmitChatPromptArgs, 'prompt'>;

type ControlPlaneTurnPublisher = ReturnType<typeof ControlPlaneChatSessionEventsController.createSessionEventPublisher>;

export class ControlPlaneChatSessionsController {
  private readonly sessionEventBus = new EventEmitter();
  private readonly pendingApprovals = new Map<string, {
    approval: ControlPlanePendingApproval;
    resolve: (decision: { approved: boolean; reason?: string }) => void;
  }>();
  private readonly inFlightRuns = new Map<string, AbortController>();

  createSession(args: CreateControlPlaneChatSessionArgs): ChatSessionDetail {
    const { suggestedName, ...engineInput } = args;
    const model = this.resolveSessionCreationModel(args);
    const credentialRuntime = {
      preferApiKey: args.preferApiKey,
      credentialStorePath: args.credentialStorePath,
    };
    const apiKeyPresent = args.apiKeyPresent ?? hasProviderCredentialForModel(model, credentialRuntime);
    const engine = createConversationEngine({
      ...engineInput,
      model,
      apiKeyPresent,
    });

    const session = engine.sessions.create({
      name: suggestedName,
      apiKeyPresent,
      model,
      workspaceId: args.workspaceId,
      retention: args.retention,
    });

    return ControlPlaneChatSessionPresenter.projectDetail(session)[0] as ChatSessionDetail;
  }

  updateSettings(args: UpdateControlPlaneChatSessionSettingsArgs): ChatSessionDetail {
    const { sessionId, settings, ...engineInput } = args;
    const updated = this.createEngine(engineInput).sessions.updateSettings(sessionId, settings);
    return ControlPlaneChatSessionPresenter.projectDetail(updated)[0] as ChatSessionDetail;
  }

  async submitPrompt(args: SubmitChatPromptArgs) {
    if (process.env.HEDDLE_E2E_FAKE_AGENT === '1') {
      return await this.runFakeE2eSessionPrompt(args);
    }

    return await this.runEngineTurn(args, async ({ engine, host, abortSignal }) => {
      return await engine.turns.submit({
        sessionId: args.sessionId,
        prompt: args.prompt,
        maxSteps: args.maxSteps,
        searchIgnoreDirs: args.searchIgnoreDirs,
        includePlanTool: args.includePlanTool,
        host,
        abortSignal,
        leaseOwner: args.leaseOwner,
      });
    });
  }

  async continuePrompt(args: ContinueChatPromptArgs) {
    if (process.env.HEDDLE_E2E_FAKE_AGENT === '1') {
      const session = this.createEngine(args).sessions.require(args.sessionId);
      if (!session.history.length || !session.lastContinuePrompt) {
        throw new Error('There is no interrupted or prior run to continue yet.');
      }

      return await this.runFakeE2eSessionPrompt({
        ...args,
        prompt: session.lastContinuePrompt,
      });
    }

    return await this.runEngineTurn(args, async ({ engine, host, abortSignal }) => {
      return await engine.turns.continue({
        sessionId: args.sessionId,
        host,
        abortSignal,
        leaseOwner: args.leaseOwner,
      });
    });
  }

  subscribeToEvents(
    sessionId: string,
    listener: (event: ControlPlaneSessionLiveEvent) => void,
  ): () => void {
    this.sessionEventBus.on(sessionId, listener);
    return () => {
      this.sessionEventBus.off(sessionId, listener);
    };
  }

  getPendingApproval(sessionId: string): ControlPlanePendingApproval | undefined {
    return this.pendingApprovals.get(sessionId)?.approval;
  }

  isRunning(sessionId: string): boolean {
    return this.inFlightRuns.has(sessionId);
  }

  cancelRun(sessionId: string): boolean {
    const controller = this.inFlightRuns.get(sessionId);
    if (!controller) {
      return false;
    }

    controller.abort();
    this.pendingApprovals.delete(sessionId);
    return true;
  }

  resolvePendingApproval(
    sessionId: string,
    decision: { approved: boolean; reason?: string },
  ): boolean {
    const pending = this.pendingApprovals.get(sessionId);
    if (!pending) {
      return false;
    }

    this.pendingApprovals.delete(sessionId);
    pending.resolve(decision);
    return true;
  }

  readViews(args: ControlPlaneSessionReadArgs): ChatSessionView[] {
    return this.createEngine(args).sessions.list()
      .flatMap((session) => ControlPlaneChatSessionPresenter.projectView(session))
      .sort((left, right) => (right.updatedAt ?? '').localeCompare(left.updatedAt ?? ''));
  }

  readDetail(args: ControlPlaneSessionReadArgs, id: string): ChatSessionDetail | undefined {
    const session = this.createEngine(args).sessions.read(id);
    return session ? ControlPlaneChatSessionPresenter.projectDetail(session)[0] : undefined;
  }

  readTurnReview(args: ControlPlaneSessionReadArgs, sessionId: string, turnId: string): ChatTurnReview | undefined {
    const session = this.readDetail(args, sessionId);
    const turn = session?.turns.find((candidate) => candidate.id === turnId);
    if (!turn) {
      return undefined;
    }

    return ControlPlaneChatTurnReviewPresenter.load(turn.traceFile);
  }

  resolveFilePath(stateRoot: string, sessionId: string): string {
    return join(stateRoot, 'chat-sessions', `${sessionId}.json`);
  }

  private async runEngineTurn(
    args: ContinueChatPromptArgs,
    run: (input: {
      engine: ConversationEngine;
      host: ConversationEngineHost;
      abortSignal: AbortSignal;
    }) => ReturnType<ConversationEngine['turns']['submit']>,
  ) {
    if (this.inFlightRuns.has(args.sessionId)) {
      throw new Error('A run is already in progress for this session.');
    }

    const controller = new AbortController();
    this.inFlightRuns.set(args.sessionId, controller);
    const publisher = ControlPlaneChatSessionEventsController.createSessionEventPublisher({
      eventBus: this.sessionEventBus,
      sessionId: args.sessionId,
    });

    try {
      const result = await run({
        engine: this.createEngine(args),
        host: this.createEngineHost(args.sessionId, publisher),
        abortSignal: controller.signal,
      });
      return {
        ...result,
        session: ControlPlaneChatSessionPresenter.projectDetail(result.session)[0] ?? null,
      };
    } finally {
      this.pendingApprovals.delete(args.sessionId);
      this.inFlightRuns.delete(args.sessionId);
    }
  }

  private createEngine(args: ControlPlaneSessionReadArgs): ConversationEngine {
    return createConversationEngine({
      ...args,
      model: args.model ?? DEFAULT_OPENAI_MODEL,
    });
  }

  private createEngineHost(sessionId: string, publisher: ControlPlaneTurnPublisher): ConversationEngineHost {
    return {
      events: {
        onAgentLoopEvent: publisher.publishAgentLoopEvent,
      },
      compaction: {
        onStatus: publisher.publishCompactionStatus,
      },
      approvals: {
        requestToolApproval: async ({ call, tool }: { call: ToolCall; tool: ToolDefinition }) => {
          const decision = await requestToolApproval({
            call,
            tool,
            createView: ControlPlaneChatSessionEventsController.createPendingApprovalView,
            storePending: ({ view, resolve }) => {
              this.pendingApprovals.set(sessionId, {
                approval: view,
                resolve,
              });
            },
            publish: (_view, callForEvent) => {
              publisher.publishApprovalRequested(callForEvent);
            },
          });
          this.pendingApprovals.delete(sessionId);
          return decision;
        },
      },
    };
  }

  private async runFakeE2eSessionPrompt(args: SubmitChatPromptArgs) {
    // Desired shape: fake E2E should become an injectable engine test host.
    // This is the only control-plane session path that should mutate the file
    // repository directly.
    const session = readChatSession(args.sessionStoragePath, args.sessionId, true);
    if (!session) {
      throw new Error(`Chat session not found: ${args.sessionId}`);
    }

    const timestamp = new Date().toISOString();
    const assistantText = `Mocked E2E agent response: ${args.prompt}`;
    const nextHistory = [
      ...session.history,
      { role: 'user' as const, content: args.prompt },
      { role: 'assistant' as const, content: assistantText },
    ];
    const nextTurn: TurnSummary = {
      id: `e2e-turn-${Date.now()}`,
      prompt: args.prompt,
      outcome: 'done',
      summary: assistantText,
      steps: 1,
      traceFile: 'e2e-fake-trace.jsonl',
      events: ['Mocked E2E session run completed.'],
    };
    const updatedSession: ChatSession = {
      ...session,
      history: nextHistory,
      messages: buildConversationMessages(nextHistory),
      turns: [...session.turns, nextTurn].slice(-8),
      updatedAt: timestamp,
      lastContinuePrompt: args.prompt,
      lease: undefined,
    };

    saveChatSessions(
      args.sessionStoragePath,
      readChatSessionCatalog(args.sessionStoragePath)
        .map((entry) => readChatSession(args.sessionStoragePath, entry.id, true))
        .filter((candidate): candidate is ChatSession => Boolean(candidate))
        .map((candidate) => candidate.id === session.id ? updatedSession : candidate),
    );

    this.sessionEventBus.emit(args.sessionId, {
      sessionId: args.sessionId,
      timestamp,
      event: {
        type: 'trace',
        runId: `e2e-${args.sessionId}`,
        timestamp,
        event: {
          type: 'run.finished',
          outcome: 'done',
          summary: assistantText,
          step: 1,
          timestamp,
        },
      },
    } satisfies ControlPlaneSessionLiveEvent);

    return {
      outcome: 'done',
      summary: assistantText,
      session: ControlPlaneChatSessionPresenter.projectDetail(updatedSession)[0] ?? null,
    };
  }

  private resolveSessionCreationModel(args: {
    model?: string;
    preferApiKey?: boolean;
    credentialStorePath?: string;
  }): string {
    const activeModel = this.firstNonEmpty(args.model, process.env.OPENAI_MODEL, process.env.ANTHROPIC_MODEL) ?? DEFAULT_OPENAI_MODEL;
    const provider = inferProviderFromModel(activeModel);
    const credentialMode = credentialModeFromSource(resolveProviderCredentialSourceForModel(activeModel, {
      preferApiKey: args.preferApiKey,
      credentialStorePath: args.credentialStorePath,
    }));

    return resolveCompatibleActiveModel({
      activeModel,
      provider,
      credentialMode,
    }).model;
  }

  private firstNonEmpty(...values: Array<string | undefined>): string | undefined {
    return values.find((value) => typeof value === 'string' && value.trim().length > 0);
  }
}

export const controlPlaneChatSessionsController = new ControlPlaneChatSessionsController();
