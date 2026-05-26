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
 * the fake browser-integration shortcut below still mutates file-backed session storage
 * directly. Keep that path isolated until test fakes can be injected through
 * the engine turn boundary.
 */
import { EventEmitter } from 'node:events';
import { watch } from 'node:fs';
import { join } from 'node:path';
import type { Logger } from 'pino';
import {
  ToolApprovalPolicies,
  ToolApprovalService,
  type ToolApprovalRequest,
  type ToolApprovalUserDecision,
} from '@/core/approvals/index.js';
import { createConversationEngine } from '@/core/chat/engine/conversation-engine.js';
import { ConversationCompactionService } from '@/core/chat/engine/compaction/index.js';
import { FileChatSessionRepository } from '@/core/chat/engine/sessions/repository/index.js';
import type {
  ConversationEngine,
  ConversationEngineConfig,
  ConversationEngineHost,
  UpdateConversationSessionSettingsInput,
} from '@/core/chat/engine/types.js';
import type { ChatSessionLeaseOwner } from '@/core/chat/engine/sessions/leases/index.js';
import { ConversationLines } from '@/core/chat/engine/sessions/records/index.js';
import type { ChatSession, TurnSummary } from '@/core/chat/types.js';
import { DEFAULT_OPENAI_MODEL } from '@/core/config.js';
import { ModelPolicyService } from '@/core/llm/models/index.js';
import { LlmAdapterService } from '@/core/llm/index.js';
import { RuntimeCredentialService } from '@/core/runtime/credentials/index.js';
import { RuntimeSubscriptionStream } from '@/core/runtime/subscriptions/index.js';
import type { ToolCall, ToolDefinition } from '@/core/types.js';
import { ControlPlaneChatSessionEventsController } from './chat-session-events.js';
import { ControlPlaneChatSessionPresenter } from './chat-session-presenter.js';
import { ControlPlaneChatTurnReviewPresenter } from './chat-turn-review-presenter.js';
import type {
  ChatSessionDetail,
  ChatSessionView,
  ChatTurnReview,
  ControlPlaneSessionEventEnvelope,
  ControlPlaneSessionLiveEvent,
  ControlPlaneSessionsEventEnvelope,
} from '@/server/control-plane-types.js';

type ControlPlaneSessionReadArgs = Omit<ConversationEngineConfig, 'model' | 'workspaceId'> & {
  model?: string;
  sessionStoragePath: string;
  workspaceId: string;
};

type CreateControlPlaneChatSessionArgs = ControlPlaneSessionReadArgs & {
  suggestedName?: string;
  retention?: ChatSession['retention'];
};

type UpdateControlPlaneChatSessionSettingsArgs = ControlPlaneSessionReadArgs & {
  sessionId: string;
  settings: UpdateConversationSessionSettingsInput;
};

type RenameControlPlaneChatSessionArgs = ControlPlaneSessionReadArgs & {
  sessionId: string;
  name: string;
};

type DeleteControlPlaneChatSessionArgs = ControlPlaneSessionReadArgs & ControlPlaneSessionAddress & {
  leaseOwner: ChatSessionLeaseOwner;
};

type ResetControlPlaneChatSessionArgs = ControlPlaneSessionReadArgs & ControlPlaneSessionAddress & {
  leaseOwner: ChatSessionLeaseOwner;
};

type CompactControlPlaneChatSessionArgs = ControlPlaneSessionReadArgs & ControlPlaneSessionAddress & {
  force?: boolean;
  leaseOwner: ChatSessionLeaseOwner;
};

type SubmitChatPromptArgs = ControlPlaneSessionReadArgs & {
  sessionId: string;
  prompt: string;
  maxSteps?: number;
  searchIgnoreDirs?: string[];
  includePlanTool?: boolean;
  leaseOwner: ChatSessionLeaseOwner;
  logger?: Pick<Logger, 'debug'>;
};

type ContinueChatPromptArgs = Omit<SubmitChatPromptArgs, 'prompt'>;

type ControlPlaneTurnPublisher = ReturnType<typeof ControlPlaneChatSessionEventsController.createSessionEventPublisher>;

type PendingControlPlaneApproval = {
  approval: ToolApprovalRequest;
  resolve: (decision: ToolApprovalUserDecision) => void;
};

type InFlightControlPlaneRun = {
  controller: AbortController;
};

export class ControlPlaneChatSessionsController {
  private readonly sessionEventBus = new EventEmitter();
  private readonly pendingApprovals = new Map<string, PendingControlPlaneApproval>();
  private readonly inFlightRuns = new Map<string, InFlightControlPlaneRun>();

  createSession(args: CreateControlPlaneChatSessionArgs): ChatSessionDetail {
    const { suggestedName, ...engineInput } = args;
    const model = this.resolveSessionCreationModel(args);
    const credentialRuntime = {
      preferApiKey: args.preferApiKey,
      credentialStorePath: args.credentialStorePath,
    };
    const apiKeyPresent = args.apiKeyPresent ?? RuntimeCredentialService.hasCredentialForModel(model, credentialRuntime);
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

  renameSession(args: RenameControlPlaneChatSessionArgs): ChatSessionDetail {
    const { sessionId, name, ...engineInput } = args;
    const updated = this.createEngine(engineInput).sessions.rename(sessionId, name);
    return ControlPlaneChatSessionPresenter.projectDetail(updated)[0] as ChatSessionDetail;
  }

  deleteSession(args: DeleteControlPlaneChatSessionArgs): { deleted: boolean } {
    this.assertNoActiveRun(args);
    const { sessionId, leaseOwner, ...engineInput } = args;
    const sessions = this.createEngine(engineInput).sessions;
    this.assertNoLeaseConflict(sessions, sessionId, leaseOwner);
    return {
      deleted: sessions.delete(sessionId),
    };
  }

  resetSession(args: ResetControlPlaneChatSessionArgs): ChatSessionDetail {
    this.assertNoActiveRun(args);
    const { sessionId, leaseOwner, ...engineInput } = args;
    const sessions = this.createEngine(engineInput).sessions;
    this.assertNoLeaseConflict(sessions, sessionId, leaseOwner);
    const session = sessions.require(sessionId);
    const model = session.model ?? args.model ?? DEFAULT_OPENAI_MODEL;
    const updated = sessions.resetConversation(sessionId, {
      apiKeyPresent: RuntimeCredentialService.hasCredentialForModel(model, {
        apiKey: args.apiKey,
        credentialStorePath: args.credentialStorePath,
        preferApiKey: args.preferApiKey,
      }),
    });
    return ControlPlaneChatSessionPresenter.projectDetail(updated)[0] as ChatSessionDetail;
  }

  async compactSession(args: CompactControlPlaneChatSessionArgs): Promise<ChatSessionDetail> {
    this.assertNoActiveRun(args);
    const sessionKey = ControlPlaneChatSessionsController.sessionAddressKey(args);
    const controller = new AbortController();
    this.inFlightRuns.set(sessionKey, { controller });
    const { sessionId, force = true, leaseOwner, ...engineInput } = args;
    const sessions = this.createEngine(engineInput).sessions;
    let leaseAcquired = false;
    let previousCompactionState: Pick<ChatSession, 'context' | 'archives'> | undefined;

    try {
      this.assertNoLeaseConflict(sessions, sessionId, leaseOwner);
      const session = sessions.acquireLease(sessionId, leaseOwner);
      leaseAcquired = true;
      const publisher = ControlPlaneChatSessionEventsController.createSessionEventPublisher({
        eventBus: this.sessionEventBus,
        workspaceId: args.workspaceId,
        sessionId,
      });
      previousCompactionState = {
        context: session.context,
        archives: session.archives,
      };

      sessions.markCompactionRunning(sessionId, { sourceHistory: session.history });
      const model = session.model ?? args.model ?? DEFAULT_OPENAI_MODEL;
      const compacted = await ConversationCompactionService.compact({
        history: session.history,
        runtime: {
          model,
          stateRoot: args.stateRoot,
          systemContext: args.systemContext,
        },
        session,
        force,
        summarizer: {
          credentialSource: RuntimeCredentialService.resolveCredentialSourceForModel(model, {
            apiKey: args.apiKey,
            credentialStorePath: args.credentialStorePath,
            preferApiKey: args.preferApiKey,
          }),
        },
        onStatusChange: publisher.publishActivity,
      });
      const updated = sessions.applyCompactionResult(sessionId, compacted);
      return ControlPlaneChatSessionPresenter.projectDetail(updated)[0] as ChatSessionDetail;
    } catch (error) {
      if (previousCompactionState) {
        sessions.restoreCompactionState(sessionId, previousCompactionState);
      }
      throw error;
    } finally {
      if (leaseAcquired) {
        sessions.releaseLease(sessionId, leaseOwner);
      }
      this.inFlightRuns.delete(sessionKey);
    }
  }

  readRunState(sessionAddress: ControlPlaneSessionAddress) {
    return {
      running: this.isRunning(sessionAddress),
      pendingApproval: this.getPendingApproval(sessionAddress) ?? null,
    };
  }

  async submitPrompt(args: SubmitChatPromptArgs) {
    if (process.env.HEDDLE_BROWSER_INTEGRATION_FAKE_AGENT === '1') {
      return await this.runFakeBrowserIntegrationSessionPrompt(args);
    }

    const result = await this.runEngineTurn(args, async ({ engine, host, abortSignal, shouldStop }) => {
      return await engine.turns.submit({
        sessionId: args.sessionId,
        prompt: args.prompt,
        maxSteps: args.maxSteps,
        searchIgnoreDirs: args.searchIgnoreDirs,
        includePlanTool: args.includePlanTool,
        host,
        abortSignal,
        shouldStop,
        leaseOwner: args.leaseOwner,
      });
    });
    this.scheduleAutoRenameAfterFirstUserMessage(args, {
      responseText: result.summary,
      sessionModel: result.session?.model,
    });
    return result;
  }

  async continuePrompt(args: ContinueChatPromptArgs) {
    if (process.env.HEDDLE_BROWSER_INTEGRATION_FAKE_AGENT === '1') {
      const session = this.createEngine(args).sessions.require(args.sessionId);
      if (!session.history.length || !session.lastContinuePrompt) {
        throw new Error('There is no interrupted or prior run to continue yet.');
      }

      return await this.runFakeBrowserIntegrationSessionPrompt({
        ...args,
        prompt: session.lastContinuePrompt,
      });
    }

    return await this.runEngineTurn(args, async ({ engine, host, abortSignal, shouldStop }) => {
      return await engine.turns.continue({
        sessionId: args.sessionId,
        host,
        abortSignal,
        shouldStop,
        leaseOwner: args.leaseOwner,
      });
    });
  }

  subscribeToEvents(
    sessionAddress: ControlPlaneSessionAddress,
    listener: (event: ControlPlaneSessionLiveEvent) => void,
  ): () => void {
    const key = ControlPlaneChatSessionsController.sessionAddressKey(sessionAddress);
    this.sessionEventBus.on(key, listener);
    return () => {
      this.sessionEventBus.off(key, listener);
    };
  }

  async *subscribeLiveEvents(args: {
    workspaceId: string;
    stateRoot: string;
    sessionId: string;
    signal?: AbortSignal;
  }): AsyncGenerator<ControlPlaneSessionEventEnvelope> {
    const stream = RuntimeSubscriptionStream.fromSources<ControlPlaneSessionEventEnvelope>({
      signal: args.signal,
      sources: [
        // Live LLM/tool/compaction updates arrive through the in-memory event
        // bus. This path streams assistant text without touching the session
        // file for each model delta.
        (sink) => this.subscribeToEvents(args, (event) => {
          sink.push({
            ...event,
            type: 'session.event',
          });
        }),
        (sink) => {
          try {
            // File changes represent durable session persistence, usually
            // after a turn finishes or settings/session metadata are saved.
            const watcher = watch(this.resolveFilePath(args.stateRoot, args.sessionId), { persistent: false }, () => {
              sink.push({
                type: 'session.updated',
                sessionId: args.sessionId,
                timestamp: new Date().toISOString(),
              });
            });
            return () => watcher.close();
          } catch {
            // A newly selected or newly created session may not have a
            // watchable file yet. Keep the subscription alive so later live
            // events can still flow.
            sink.push({
              type: 'waiting',
              sessionId: args.sessionId,
              timestamp: new Date().toISOString(),
            });
          }
        },
      ],
    });

    yield* stream;
  }

  async *subscribeSessionListEvents(args: {
    stateRoot: string;
    signal?: AbortSignal;
  }): AsyncGenerator<ControlPlaneSessionsEventEnvelope> {
    const stream = RuntimeSubscriptionStream.fromSources<ControlPlaneSessionsEventEnvelope>({
      signal: args.signal,
      sources: [
        (sink) => {
          try {
            const watcher = watch(join(args.stateRoot, 'chat-sessions.catalog.json'), { persistent: false }, () => {
              sink.push({
                type: 'sessions.updated',
                timestamp: new Date().toISOString(),
              });
            });
            return () => watcher.close();
          } catch {
            sink.push({
              type: 'waiting',
              timestamp: new Date().toISOString(),
            });
          }
        },
      ],
    });

    yield* stream;
  }

  getPendingApproval(sessionAddress: ControlPlaneSessionAddress): ToolApprovalRequest | undefined {
    return this.pendingApprovals.get(ControlPlaneChatSessionsController.sessionAddressKey(sessionAddress))?.approval;
  }

  isRunning(sessionAddress: ControlPlaneSessionAddress): boolean {
    return this.inFlightRuns.has(ControlPlaneChatSessionsController.sessionAddressKey(sessionAddress));
  }

  cancelRun(sessionAddress: ControlPlaneSessionAddress): boolean {
    const key = ControlPlaneChatSessionsController.sessionAddressKey(sessionAddress);
    const run = this.inFlightRuns.get(key);
    if (!run) {
      return false;
    }

    run.controller.abort();
    const pending = this.pendingApprovals.get(key);
    if (pending) {
      this.pendingApprovals.delete(key);
      pending.resolve({
        type: 'deny',
        reason: 'Cancelled by user',
      });
    }
    return true;
  }

  resolvePendingApproval(
    sessionAddress: ControlPlaneSessionAddress,
    decision: ToolApprovalUserDecision,
  ): boolean {
    const key = ControlPlaneChatSessionsController.sessionAddressKey(sessionAddress);
    const pending = this.pendingApprovals.get(key);
    if (!pending) {
      return false;
    }

    this.pendingApprovals.delete(key);
    // This resolves the promise created by ToolApprovalService.requestHumanApproval.
    // The paused agent turn resumes immediately after this call returns.
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
      shouldStop: () => boolean;
    }) => ReturnType<ConversationEngine['turns']['submit']>,
  ) {
    const sessionKey = ControlPlaneChatSessionsController.sessionAddressKey(args);
    if (this.inFlightRuns.has(sessionKey)) {
      throw new Error('A run is already in progress for this session.');
    }

    const controller = new AbortController();
    this.inFlightRuns.set(sessionKey, { controller });
    const publisher = ControlPlaneChatSessionEventsController.createSessionEventPublisher({
      eventBus: this.sessionEventBus,
      workspaceId: args.workspaceId,
      sessionId: args.sessionId,
    });

    try {
      const result = await run({
        engine: this.createEngine(args),
        host: this.createEngineHost(args, publisher),
        abortSignal: controller.signal,
        shouldStop: () => controller.signal.aborted,
      });
      return {
        ...result,
        session: ControlPlaneChatSessionPresenter.projectDetail(result.session)[0] ?? null,
      };
    } finally {
      this.pendingApprovals.delete(sessionKey);
      this.inFlightRuns.delete(sessionKey);
    }
  }

  private scheduleAutoRenameAfterFirstUserMessage(
    args: SubmitChatPromptArgs,
    input: { responseText: string; sessionModel?: string },
  ): void {
    const titleLlm = this.createSessionTitleLlm(args, input.sessionModel);
    if (!titleLlm) {
      return;
    }

    void this.createEngine(args).sessions.autoRenameAfterFirstUserMessage(args.sessionId, {
      llm: titleLlm,
      prompt: args.prompt,
      responseText: input.responseText,
    }).catch((error: unknown) => {
      args.logger?.debug(
        { error: error instanceof Error ? error.message : String(error), sessionId: args.sessionId },
        'Session auto-title failed',
      );
    });
  }

  private createSessionTitleLlm(
    args: Pick<ControlPlaneSessionReadArgs, 'preferApiKey' | 'credentialStorePath' | 'model'>,
    sessionModel: string | undefined,
  ) {
    const activeModel = sessionModel ?? args.model ?? DEFAULT_OPENAI_MODEL;
    const credentialMode = ModelPolicyService.credentialModeFromSource(
      RuntimeCredentialService.resolveCredentialSourceForModel(activeModel, args),
    );
    const titleModel = ModelPolicyService.resolveSystemSelectedModel({
      purpose: 'session-title',
      provider: 'openai',
      activeModel,
      credentialMode,
    });
    const titleCredentialSource = RuntimeCredentialService.resolveCredentialSourceForModel(titleModel, args);
    if (titleCredentialSource.type === 'missing') {
      return undefined;
    }

    return LlmAdapterService.create({
      model: titleModel,
      credentials: {
        apiKey: RuntimeCredentialService.resolveApiKeyForModel(titleModel, args),
        credentialStorePath: args.credentialStorePath,
      },
    });
  }

  private createEngine(args: ControlPlaneSessionReadArgs): ConversationEngine {
    const approvalService = this.createApprovalService(args);
    return createConversationEngine({
      ...args,
      model: args.model ?? DEFAULT_OPENAI_MODEL,
      approvalPolicies: [
        ...(args.approvalPolicies ?? []),
        ToolApprovalPolicies.rememberedProjectRule({
          isApproved: (context) => approvalService.isApprovedByRememberedProjectRule(context),
        }),
      ],
    });
  }

  private createEngineHost(args: ControlPlaneSessionReadArgs & ControlPlaneSessionAddress, publisher: ControlPlaneTurnPublisher): ConversationEngineHost {
    const sessionKey = ControlPlaneChatSessionsController.sessionAddressKey(args);
    const approvalService = this.createApprovalService(args);

    return {
      events: {
        onActivity: publisher.publishActivity,
      },
      approvals: {
        requestToolApproval: async ({ call, tool }: { call: ToolCall; tool: ToolDefinition }) => {
          const decision = await approvalService.requestHumanApproval({
            call,
            tool,
            workspaceRoot: args.workspaceRoot,
            storePending: ({ request, resolve }) => {
              // Keep the resolver in memory while the browser renders the
              // request. sessionResolveApproval later calls this resolver.
              this.pendingApprovals.set(sessionKey, {
                approval: request,
                resolve,
              });
            },
          });
          this.pendingApprovals.delete(sessionKey);
          return decision;
        },
      },
    };
  }

  private createApprovalService(args: Pick<ControlPlaneSessionReadArgs, 'stateRoot' | 'workspaceRoot'>): ToolApprovalService {
    return new ToolApprovalService({
      workspaceRoot: args.workspaceRoot,
      projectApprovalRulesFile: join(args.stateRoot, 'command-approvals.json'),
    });
  }

  private assertNoActiveRun(sessionAddress: ControlPlaneSessionAddress): void {
    if (this.isRunning(sessionAddress)) {
      throw new Error('A run is already in progress for this session.');
    }
  }

  private assertNoLeaseConflict(
    sessions: ConversationEngine['sessions'],
    sessionId: string,
    leaseOwner: ChatSessionLeaseOwner,
  ): void {
    const conflict = sessions.getLeaseConflict(sessionId, leaseOwner);
    if (conflict) {
      throw new Error(conflict);
    }
  }

  private async runFakeBrowserIntegrationSessionPrompt(args: SubmitChatPromptArgs) {
    // Desired shape: fake browser integration should become an injectable engine test host.
    // This is the only control-plane session path that should mutate the file
    // repository directly.
    const repository = new FileChatSessionRepository({ sessionStoragePath: args.sessionStoragePath });
    const session = repository.read(args.sessionId, true);
    if (!session) {
      throw new Error(`Chat session not found: ${args.sessionId}`);
    }

    const timestamp = new Date().toISOString();
    const assistantText = `Mocked browser integration agent response: ${args.prompt}`;
    await this.emitBrowserIntegrationStreamPreview(args, assistantText);
    const nextHistory = [
      ...session.history,
      { role: 'user' as const, content: args.prompt },
      { role: 'assistant' as const, content: assistantText },
    ];
    const nextTurn: TurnSummary = {
      id: `browser-integration-turn-${Date.now()}`,
      prompt: args.prompt,
      outcome: 'done',
      summary: assistantText,
      steps: 1,
      traceFile: 'browser-integration-fake-trace.jsonl',
      events: ['Mocked browser integration session run completed.'],
    };
    const updatedSession: ChatSession = {
      ...session,
      history: nextHistory,
      messages: ConversationLines.fromHistory(nextHistory),
      turns: [...session.turns, nextTurn].slice(-8),
      updatedAt: timestamp,
      lastContinuePrompt: args.prompt,
      lease: undefined,
    };

    repository.save(
      repository.readCatalog()
        .map((entry) => repository.read(entry.id, true))
        .filter((candidate): candidate is ChatSession => Boolean(candidate))
        .map((candidate) => candidate.id === session.id ? updatedSession : candidate),
    );

    return {
      outcome: 'done',
      summary: assistantText,
      session: ControlPlaneChatSessionPresenter.projectDetail(updatedSession)[0] ?? null,
    };
  }

  private async emitBrowserIntegrationStreamPreview(sessionAddress: ControlPlaneSessionAddress, assistantText: string): Promise<void> {
    // The browser-integration fake has to emit a real live activity before its
    // final mutation result so web-v2 can regression-test incremental streaming.
    const publisher = ControlPlaneChatSessionEventsController.createSessionEventPublisher({
      eventBus: this.sessionEventBus,
      workspaceId: sessionAddress.workspaceId,
      sessionId: sessionAddress.sessionId,
    });
    const runId = `browser-integration-run-${Date.now()}`;
    const timestamp = new Date().toISOString();

    publisher.publishActivity({
      source: 'agent-loop',
      type: 'assistant.stream',
      runId,
      step: 1,
      text: assistantText.slice(0, 'Mocked browser integration agent response'.length),
      done: false,
      timestamp,
    });

    await new Promise((resolve) => {
      setTimeout(resolve, 750);
    });
  }

  private resolveSessionCreationModel(args: {
    model?: string;
    preferApiKey?: boolean;
    credentialStorePath?: string;
  }): string {
    const activeModel = this.firstNonEmpty(args.model, process.env.OPENAI_MODEL, process.env.ANTHROPIC_MODEL) ?? DEFAULT_OPENAI_MODEL;
    const provider = LlmAdapterService.inferProvider(activeModel);
    const credentialMode = ModelPolicyService.credentialModeFromSource(RuntimeCredentialService.resolveCredentialSourceForModel(activeModel, {
      preferApiKey: args.preferApiKey,
      credentialStorePath: args.credentialStorePath,
    }));

    return ModelPolicyService.resolveCompatibleActiveModel({
      activeModel,
      provider,
      credentialMode,
    }).model;
  }

  private firstNonEmpty(...values: Array<string | undefined>): string | undefined {
    return values.find((value) => typeof value === 'string' && value.trim().length > 0);
  }

  static sessionAddressKey(address: ControlPlaneSessionAddress): string {
    return `${address.workspaceId}:${address.sessionId}`;
  }
}

type ControlPlaneSessionAddress = {
  workspaceId: string;
  sessionId: string;
};

export const controlPlaneChatSessionsController = new ControlPlaneChatSessionsController();
