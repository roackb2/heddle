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
  AutonomyPermissionModeService,
  ToolApprovalPolicies,
  ToolApprovalService,
  type AutopilotProfile,
  type ToolApprovalRequest,
  type ToolApprovalPolicy,
  type ToolApprovalUserDecision,
} from '@/core/approvals/index.js';
import { createConversationEngine } from '@/core/chat/engine/conversation-engine.js';
import { ConversationCompactionService } from '@/core/chat/engine/compaction/index.js';
import { ConversationDirectShellService } from '@/core/chat/engine/direct-shell/index.js';
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
import { CustomAgentService, type CustomAgentExecutionSnapshot } from '@/core/custom-agents/index.js';
import { DEFAULT_OPENAI_MODEL } from '@/core/config.js';
import { ModelPolicyService } from '@/core/llm/models/index.js';
import { LlmAdapterService } from '@/core/llm/index.js';
import { RuntimeCredentialService } from '@/core/runtime/credentials/index.js';
import { LlmProviderRuntimeService } from '@/core/runtime/provider-runtime/index.js';
import { RuntimeSubscriptionStream } from '@/core/runtime/subscriptions/index.js';
import { ProjectConfigService } from '@/core/project-config/index.js';
import { ControlPlaneChatSessionEventsController } from './chat-session-events.js';
import { ControlPlaneChatSessionPresenter } from './chat-session-presenter.js';
import { ControlPlaneChatTurnReviewPresenter } from './chat-turn-review-presenter.js';
import type {
  ChatSessionDetail,
  ChatSessionView,
  ChatTurnReview,
  ControlPlaneAcceptedSessionRun,
  ControlPlaneSessionEventEnvelope,
  ControlPlaneSessionLiveEvent,
  ControlPlaneSessionsEventEnvelope,
} from '@/server/control-plane-types.js';
import {
  ControlPlaneSessionRunService,
  type ControlPlaneSessionRunContext,
} from '@/server/services/control-plane/session-run-service.js';

type ControlPlaneSessionReadArgs = Omit<ConversationEngineConfig, 'model' | 'workspaceId'> & {
  model?: string;
  sessionStoragePath: string;
  workspaceId: string;
  autopilot?: AutopilotProfile;
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

type UpdatePinnedControlPlaneChatSessionArgs = ControlPlaneSessionReadArgs & {
  sessionId: string;
  pinned: boolean;
};

type UpdateArchivedControlPlaneChatSessionArgs = ControlPlaneSessionReadArgs & {
  sessionId: string;
  archived: boolean;
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
  agentProfileId?: string;
  agentSnapshot?: CustomAgentExecutionSnapshot;
  maxSteps?: number;
  searchIgnoreDirs?: string[];
  includePlanTool?: boolean;
  leaseOwner: ChatSessionLeaseOwner;
  logger?: Pick<Logger, 'debug'>;
};

type ContinueChatPromptArgs = Omit<SubmitChatPromptArgs, 'prompt'>;

type SubmitDirectShellArgs = ControlPlaneSessionReadArgs & ControlPlaneSessionAddress & {
  command: string;
  riskAccepted?: boolean;
  systemContext?: string;
  apiKey?: string;
  preferApiKey?: boolean;
  leaseOwner: ChatSessionLeaseOwner;
  logger?: Pick<Logger, 'debug'>;
};

type ControlPlaneTurnPublisher = ReturnType<typeof ControlPlaneChatSessionEventsController.createSessionEventPublisher>;

type UpdateQueuedChatPromptArgs = ControlPlaneSessionReadArgs & ControlPlaneSessionAddress & {
  queueItemId: string;
  prompt: string;
};

type DeleteQueuedChatPromptArgs = ControlPlaneSessionReadArgs & ControlPlaneSessionAddress & {
  queueItemId: string;
};

export class ControlPlaneChatSessionsController {
  private readonly sessionEventBus = new EventEmitter();
  private readonly runService = new ControlPlaneSessionRunService();

  createSession(args: CreateControlPlaneChatSessionArgs): ChatSessionDetail {
    const { suggestedName, ...engineInput } = args;
    const model = this.resolveSessionCreationModel(args);
    const engine = this.createEngine({
      ...engineInput,
      model,
    });

    const session = engine.sessions.create({
      name: suggestedName,
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

  updatePinned(args: UpdatePinnedControlPlaneChatSessionArgs): ChatSessionDetail {
    const { sessionId, pinned, ...engineInput } = args;
    const updated = this.createEngine(engineInput).sessions.setPinned(sessionId, pinned);
    return ControlPlaneChatSessionPresenter.projectDetail(updated)[0] as ChatSessionDetail;
  }

  updateArchived(args: UpdateArchivedControlPlaneChatSessionArgs): ChatSessionDetail {
    const { sessionId, archived, ...engineInput } = args;
    const updated = this.createEngine(engineInput).sessions.setArchived(sessionId, archived);
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
    const updated = sessions.resetConversation(sessionId);
    return ControlPlaneChatSessionPresenter.projectDetail(updated)[0] as ChatSessionDetail;
  }

  async compactSession(args: CompactControlPlaneChatSessionArgs): Promise<ChatSessionDetail> {
    return await this.runService.startAndWait({
      address: args,
      onHeartbeat: () => {
        this.createEngine(args).sessions.refreshLease(args.sessionId, args.leaseOwner);
      },
      execute: async () => {
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
        }
      },
    });
  }

  readRunState(sessionAddress: ControlPlaneSessionAddress) {
    return {
      running: this.isRunning(sessionAddress),
      pendingApproval: this.getPendingApproval(sessionAddress) ?? null,
    };
  }

  async submitPrompt(args: SubmitChatPromptArgs) {
    return await this.runService.startAndWait(this.buildSubmitPromptRun(this.prepareSubmitPromptArgs(args)));
  }

  submitPromptAsync(args: SubmitChatPromptArgs): ControlPlaneAcceptedSessionRun {
    const preparedArgs = this.prepareSubmitPromptArgs(args);
    if (this.isRunning(preparedArgs) || this.hasQueuedPrompts(preparedArgs)) {
      const queued = this.enqueuePrompt(preparedArgs);
      if (!this.isRunning(preparedArgs)) {
        this.startNextQueuedPrompt(preparedArgs);
      }
      return queued;
    }

    return this.startPromptRun(preparedArgs);
  }

  submitDirectShellAsync(args: SubmitDirectShellArgs): ControlPlaneAcceptedSessionRun {
    return this.runService.start(this.buildDirectShellRun(args));
  }

  preflightDirectShell(command: string) {
    return ConversationDirectShellService.preflight(command);
  }

  updateQueuedPrompt(args: UpdateQueuedChatPromptArgs): ChatSessionDetail {
    const updated = this.createEngine(args).sessions.updateQueuedPrompt(args.sessionId, {
      queueItemId: args.queueItemId,
      prompt: args.prompt,
    });
    this.publishQueueUpdated(args, updated);
    return ControlPlaneChatSessionPresenter.projectDetail(updated)[0] as ChatSessionDetail;
  }

  deleteQueuedPrompt(args: DeleteQueuedChatPromptArgs): ChatSessionDetail {
    const updated = this.createEngine(args).sessions.deleteQueuedPrompt(args.sessionId, {
      queueItemId: args.queueItemId,
    });
    this.publishQueueUpdated(args, updated);
    return ControlPlaneChatSessionPresenter.projectDetail(updated)[0] as ChatSessionDetail;
  }

  async continuePrompt(args: ContinueChatPromptArgs) {
    return await this.runService.startAndWait(this.buildContinuePromptRun(args));
  }

  subscribeToEvents(
    sessionAddress: ControlPlaneSessionAddress,
    listener: (event: ControlPlaneSessionLiveEvent | Extract<ControlPlaneSessionEventEnvelope, { type: 'session.approval.updated' }>) => void,
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
          if ('type' in event) {
            sink.push(event);
            return;
          }

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
    return this.runService.getPendingApproval(sessionAddress);
  }

  isRunning(sessionAddress: ControlPlaneSessionAddress): boolean {
    return this.runService.isRunning(sessionAddress);
  }

  cancelRun(sessionAddress: ControlPlaneSessionAddress): boolean {
    return this.runService.cancelRun(sessionAddress);
  }

  resolvePendingApproval(
    sessionAddress: ControlPlaneSessionAddress,
    decision: ToolApprovalUserDecision,
  ): boolean {
    return this.runService.resolvePendingApproval(sessionAddress, decision);
  }

  readViews(args: ControlPlaneSessionReadArgs): ChatSessionView[] {
    return this.createEngine(args).sessions.list()
      .flatMap((session) => ControlPlaneChatSessionPresenter.projectView(session));
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

  private startPromptRun(args: SubmitChatPromptArgs): ControlPlaneAcceptedSessionRun {
    return this.runService.start(this.buildSubmitPromptRun(args));
  }

  private enqueuePrompt(args: SubmitChatPromptArgs): ControlPlaneAcceptedSessionRun {
    const queued = this.createEngine(args).sessions.enqueuePrompt(args.sessionId, {
      prompt: args.prompt,
      agentProfileId: args.agentProfileId,
      agentSnapshot: args.agentSnapshot,
    });
    this.publishQueueUpdated(args, queued.session);

    return {
      queued: true,
      workspaceId: args.workspaceId,
      sessionId: args.sessionId,
      queueItemId: queued.item.id,
      queuedAt: queued.item.createdAt,
      position: queued.position,
    };
  }

  private hasQueuedPrompts(args: ControlPlaneSessionAddress & ControlPlaneSessionReadArgs): boolean {
    return (this.createEngine(args).sessions.read(args.sessionId)?.queuedPrompts.length ?? 0) > 0;
  }

  private startNextQueuedPrompt(args: SubmitChatPromptArgs): void {
    if (this.isRunning(args)) {
      return;
    }

    const sessions = this.createEngine(args).sessions;
    const dequeued = sessions.dequeueQueuedPrompt(args.sessionId);
    if (!dequeued.item) {
      return;
    }

    this.publishQueueUpdated(args, dequeued.session);
    try {
      this.startPromptRun(this.prepareSubmitPromptArgs({
        ...args,
        prompt: dequeued.item.prompt,
        agentProfileId: dequeued.item.agentProfileId,
        agentSnapshot: dequeued.item.agentSnapshot,
      }));
    } catch (error) {
      const restored = sessions.enqueuePrompt(args.sessionId, {
        prompt: dequeued.item.prompt,
        agentProfileId: dequeued.item.agentProfileId,
        agentSnapshot: dequeued.item.agentSnapshot,
      });
      this.publishQueueUpdated(args, restored.session);
      args.logger?.debug(
        { error: error instanceof Error ? error.message : String(error), sessionId: args.sessionId },
        'Queued prompt drain failed',
      );
    }
  }

  private publishQueueUpdated(address: ControlPlaneSessionAddress, session: ChatSession): void {
    const publisher = ControlPlaneChatSessionEventsController.createSessionEventPublisher({
      eventBus: this.sessionEventBus,
      workspaceId: address.workspaceId,
      sessionId: address.sessionId,
    });
    publisher.publishQueueUpdated(session.queuedPrompts.length);
  }

  private buildSubmitPromptRun(args: SubmitChatPromptArgs) {
    return {
      address: args,
      onAccepted: (run: ControlPlaneSessionRunContext) => {
        this.createEngine(args).sessions.acceptUserMessage(args.sessionId, {
          runId: run.runId,
          prompt: args.prompt,
          leaseOwner: args.leaseOwner,
        });
      },
      onHeartbeat: () => {
        this.createEngine(args).sessions.refreshLease(args.sessionId, args.leaseOwner);
      },
      execute: async (run: ControlPlaneSessionRunContext) => {
        const result = process.env.HEDDLE_BROWSER_INTEGRATION_FAKE_AGENT === '1'
          ? await this.runFakeBrowserIntegrationSessionPrompt(args)
          : await this.runEngineTurn(args, run, async ({ engine, host, abortSignal, shouldStop }) => {
            return await engine.turns.submit({
              ...args,
              agentProfileId: args.agentProfileId,
              agentSnapshot: args.agentSnapshot,
              host,
              abortSignal,
              shouldStop,
            });
          });

        this.scheduleAutoRenameAfterFirstUserMessage(args, {
          responseText: result.summary,
          sessionModel: result.session?.model,
        });
        return result;
      },
      onError: (error: unknown, run: ControlPlaneSessionRunContext) => {
        this.persistRunFailureMessage(args, run, error);
      },
      onSettled: () => {
        this.startNextQueuedPrompt(args);
      },
    };
  }

  private buildContinuePromptRun(args: ContinueChatPromptArgs) {
    return {
      address: args,
      onHeartbeat: () => {
        this.createEngine(args).sessions.refreshLease(args.sessionId, args.leaseOwner);
      },
      execute: async (run: ControlPlaneSessionRunContext) => {
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

        return await this.runEngineTurn(args, run, async ({ engine, host, abortSignal, shouldStop }) => {
          return await engine.turns.continue({
            sessionId: args.sessionId,
            host,
            abortSignal,
            shouldStop,
            leaseOwner: args.leaseOwner,
          });
        });
      },
      onError: (error: unknown, run: ControlPlaneSessionRunContext) => {
        this.persistRunFailureMessage(args, run, error);
      },
    };
  }

  private buildDirectShellRun(args: SubmitDirectShellArgs) {
    return {
      address: args,
      onHeartbeat: () => {
        this.createEngine(args).sessions.refreshLease(args.sessionId, args.leaseOwner);
      },
      execute: async (run: ControlPlaneSessionRunContext) => {
        const publisher = ControlPlaneChatSessionEventsController.createSessionEventPublisher({
          eventBus: this.sessionEventBus,
          workspaceId: args.workspaceId,
          sessionId: args.sessionId,
        });
        const sessions = this.createEngine(args).sessions;
        const session = sessions.require(args.sessionId);
        this.assertNoLeaseConflict(sessions, args.sessionId, args.leaseOwner);
        sessions.acquireLease(args.sessionId, args.leaseOwner);

        try {
          const result = await ConversationDirectShellService.execute({
            sessionId: args.sessionId,
            runId: run.runId,
            command: args.command,
            model: session.model ?? args.model ?? DEFAULT_OPENAI_MODEL,
            workspaceRoot: args.workspaceRoot,
            stateRoot: args.stateRoot,
            systemContext: args.systemContext,
            riskAccepted: args.riskAccepted,
            credentialSource: RuntimeCredentialService.resolveCredentialSourceForModel(session.model ?? args.model ?? DEFAULT_OPENAI_MODEL, args),
            sessions,
            abortSignal: run.controller.signal,
            onActivity: publisher.publishActivity,
            onCompactionStatus: publisher.publishActivity,
          });

          if (result.outcome === 'done') {
            this.scheduleAutoRenameAfterFirstUserMessage({
              ...args,
              prompt: result.shellDisplay,
            }, {
              responseText: result.summary,
              sessionModel: session.model,
            });
          }

          return {
            outcome: result.outcome,
            summary: result.summary,
            session: ControlPlaneChatSessionPresenter.projectDetail(sessions.require(args.sessionId))[0] ?? null,
          };
        } finally {
          sessions.releaseLease(args.sessionId, args.leaseOwner);
        }
      },
      onError: (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.createEngine(args).sessions.appendMessage(args.sessionId, {
          id: `direct-shell-error-${Date.now()}`,
          role: 'assistant',
          text: `Direct shell execution failed:\n${message}`,
        });
      },
    };
  }

  private async runEngineTurn(
    args: ContinueChatPromptArgs,
    runContext: ControlPlaneSessionRunContext,
    run: (input: {
      engine: ConversationEngine;
      host: ConversationEngineHost;
      abortSignal: AbortSignal;
      shouldStop: () => boolean;
    }) => ReturnType<ConversationEngine['turns']['submit']>,
  ) {
    const publisher = ControlPlaneChatSessionEventsController.createSessionEventPublisher({
      eventBus: this.sessionEventBus,
      workspaceId: args.workspaceId,
      sessionId: args.sessionId,
    });

    const result = await run({
      engine: this.createEngine(args),
      host: this.createEngineHost(args, publisher),
      abortSignal: runContext.controller.signal,
      shouldStop: () => runContext.controller.signal.aborted,
    });
    return {
      ...result,
      session: ControlPlaneChatSessionPresenter.projectDetail(result.session)[0] ?? null,
    };
  }

  private prepareSubmitPromptArgs(args: SubmitChatPromptArgs): SubmitChatPromptArgs {
    if (!args.agentProfileId || args.agentSnapshot) {
      return args;
    }

    return {
      ...args,
      agentSnapshot: new CustomAgentService({
        workspaceRoot: args.workspaceRoot,
      }).resolveExecutionSnapshot(args.agentProfileId),
    };
  }

  private persistRunFailureMessage(
    args: ContinueChatPromptArgs,
    run: ControlPlaneSessionRunContext,
    error: unknown,
  ): void {
    const message = error instanceof Error ? error.message : String(error);
    this.createEngine(args).sessions.markAcceptedUserMessageFailed(args.sessionId, {
      runId: run.runId,
      failureMessage: {
        id: `accepted-run-error-${run.runId}`,
        role: 'assistant',
        text: `Run failed before a final answer: ${message}`,
      },
    });
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
      provider: LlmAdapterService.inferProvider(activeModel),
      activeModel,
      credentialMode,
    });
    const providerRuntime = LlmProviderRuntimeService.resolve({
      ...args,
      model: titleModel,
    });
    if (providerRuntime.credentialSource.type === 'missing') {
      return undefined;
    }

    return LlmAdapterService.create({
      model: titleModel,
      credentials: {
        apiKey: providerRuntime.apiKey,
        credentialStorePath: args.credentialStorePath,
      },
      runtime: providerRuntime.llmRuntime,
    });
  }

  private createEngine(args: ControlPlaneSessionReadArgs): ConversationEngine {
    const { autopilot, ...engineArgs } = args;
    const approvalService = this.createApprovalService(args);
    return createConversationEngine({
      ...engineArgs,
      model: args.model ?? DEFAULT_OPENAI_MODEL,
      approvalPolicies: this.createApprovalPolicies({
        approvalPolicies: args.approvalPolicies,
        autopilot,
        approvalService,
      }),
    });
  }

  private createApprovalPolicies(args: {
    approvalPolicies?: ToolApprovalPolicy[];
    autopilot?: AutopilotProfile;
    approvalService: ToolApprovalService;
  }): ToolApprovalPolicy[] {
    return [
      ...(args.autopilot ? [ToolApprovalPolicies.autopilot({ profile: args.autopilot })] : []),
      ...(args.approvalPolicies ?? []),
      ToolApprovalPolicies.rememberedProjectRule({
        isApproved: (context) => args.approvalService.isApprovedByRememberedProjectRule(context),
      }),
    ];
  }

  private createEngineHost(args: ControlPlaneSessionReadArgs & ControlPlaneSessionAddress, publisher: ControlPlaneTurnPublisher): ConversationEngineHost {
    const approvalService = this.createApprovalService(args);

    return {
      events: {
        onActivity: publisher.publishActivity,
      },
      approvals: {
        requestToolApproval: async ({ call, tool, autonomyEvaluation }) => {
          const decision = await approvalService.requestHumanApproval({
            call,
            tool,
            workspaceRoot: args.workspaceRoot,
            autonomyEvaluation,
            storePending: ({ request, resolve }) => {
              // Keep the resolver in memory while the browser renders the
              // request. sessionResolveApproval later calls this resolver.
              this.runService.storePendingApproval(args, {
                approval: request,
                resolve: (decision) => resolve(this.applyPendingApprovalProfileDecision({
                  engineArgs: args,
                  request,
                  decision,
                })),
              });
              publisher.publishApprovalUpdated();
            },
          });
          this.runService.clearPendingApproval(args);
          publisher.publishApprovalUpdated();
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

  private applyPendingApprovalProfileDecision(input: {
    engineArgs: ControlPlaneSessionReadArgs;
    request: ToolApprovalRequest;
    decision: ToolApprovalUserDecision;
  }): ToolApprovalUserDecision {
    if (input.decision.type !== 'approve_and_trust_autopilot_root') {
      return input.decision;
    }

    const rootApproval = input.request.autopilotRootApproval;
    if (!rootApproval || input.engineArgs.autopilot?.preset !== 'auto') {
      return {
        type: 'deny',
        reason: 'No Auto repo root is available for this approval.',
      };
    }

    try {
      ProjectConfigService.update(input.engineArgs.workspaceRoot, (config) => (
        AutonomyPermissionModeService.trustAutoRoot({
          config,
          workspaceRoot: input.engineArgs.workspaceRoot,
          root: rootApproval.root,
        })
      ));
      AutonomyPermissionModeService.addTrustedRootToProfile({
        profile: input.engineArgs.autopilot,
        workspaceRoot: input.engineArgs.workspaceRoot,
        root: rootApproval.root,
      });

      return {
        type: 'approve_and_trust_autopilot_root',
        reason: input.decision.reason ?? `Approved and trusted ${rootApproval.relativeRoot} for Auto`,
      };
    } catch (error) {
      return {
        type: 'deny',
        reason: `Could not update Auto profile: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
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
    const session = repository.read(args.sessionId);
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
      agent: args.agentSnapshot ? {
        id: args.agentSnapshot.agentProfileId,
        name: args.agentSnapshot.agentName,
        modeAlias: args.agentSnapshot.modeAlias,
        source: args.agentSnapshot.source,
        definitionHash: args.agentSnapshot.definitionHash,
      } : undefined,
      agentSnapshot: args.agentSnapshot,
    };
    const latestSession = repository.read(args.sessionId) ?? session;
    const updatedSession: ChatSession = {
      ...session,
      history: nextHistory,
      messages: ConversationLines.fromHistory(nextHistory),
      turns: [...session.turns, nextTurn].slice(-8),
      updatedAt: timestamp,
      lastContinuePrompt: args.prompt,
      lease: undefined,
      queuedPrompts: latestSession.queuedPrompts,
    };

    repository.save(
      repository.readCatalog()
        .map((entry) => repository.read(entry.id))
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
