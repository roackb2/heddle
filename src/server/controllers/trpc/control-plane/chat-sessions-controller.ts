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
 * the fake browser-integration shortcut still bypasses the engine turn
 * boundary, but it mutates state through the session service so persistence
 * concurrency semantics stay consistent with real runs.
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
import type {
  ConversationEngine,
  ConversationEngineConfig,
  ConversationEngineHost,
  UpdateConversationSessionSettingsInput,
} from '@/core/chat/engine/types.js';
import type { ChatSessionLeaseOwner } from '@/core/chat/engine/sessions/leases/index.js';
import type { ChatSession } from '@/core/chat/types.js';
import {
  ConversationRunService,
  type ConversationRunContext,
} from '@/core/chat/runs/index.js';
import { CustomAgentService, type CustomAgentExecutionSnapshot } from '@/core/custom-agents/index.js';
import { DEFAULT_OPENAI_MODEL } from '@/core/config.js';
import type { ConversationActivity } from '@/core/live/index.js';
import { ModelPolicyService } from '@/core/llm/models/index.js';
import { LlmAdapterService } from '@/core/llm/index.js';
import { RuntimeCredentialService } from '@/core/runtime/credentials/index.js';
import { LlmProviderRuntimeService } from '@/core/runtime/provider-runtime/index.js';
import { RuntimeSubscriptionStream } from '@/core/runtime/subscriptions/index.js';
import { ProjectConfigService } from '@/core/project-config/index.js';
import { ControlPlaneChatSessionBrowserIntegrationFake } from './chat-session-browser-integration-fake.js';
import { ControlPlaneChatSessionEventsController } from './chat-session-events.js';
import { ControlPlaneChatSessionPresenter } from './chat-session-presenter.js';
import {
  ControlPlaneChatSessionRunStreamController,
  type ControlPlaneSessionAddress,
} from './chat-session-run-stream.js';
import { ControlPlaneChatTurnReviewPresenter } from './chat-turn-review-presenter.js';
import type {
  ChatSessionDetail,
  ChatSessionView,
  ChatTurnReview,
  ControlPlaneAcceptedSessionRun,
  ControlPlaneSessionEventEnvelope,
  ControlPlaneSessionRunEventEnvelope,
  ControlPlaneSessionsEventEnvelope,
} from '@/server/control-plane-types.js';

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
  systemContext?: string;
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

type ControlPlaneTurnPublisher = ReturnType<typeof ControlPlaneChatSessionEventsController.createSessionEventPublisher> & {
  publishActivity: (activity: ConversationActivity) => void;
  publishActivities: (activities: ConversationActivity[]) => void;
};

type UpdateQueuedChatPromptArgs = ControlPlaneSessionReadArgs & ControlPlaneSessionAddress & {
  queueItemId: string;
  prompt: string;
};

type DeleteQueuedChatPromptArgs = ControlPlaneSessionReadArgs & ControlPlaneSessionAddress & {
  queueItemId: string;
};

export class ControlPlaneChatSessionsController {
  private readonly sessionEventBus = new EventEmitter();
  private readonly runService = new ConversationRunService<ControlPlaneSessionAddress>({
    addressKey: ControlPlaneChatSessionsController.sessionAddressKey,
  });
  private readonly runStreams = new ControlPlaneChatSessionRunStreamController({
    eventBus: this.sessionEventBus,
    runService: this.runService,
  });

  async createSession(args: CreateControlPlaneChatSessionArgs): Promise<ChatSessionDetail> {
    const { suggestedName, ...engineInput } = args;
    const model = this.resolveSessionCreationModel(args);
    const engine = this.createEngine({
      ...engineInput,
      model,
    });

    const session = await engine.sessions.create({
      name: suggestedName,
      model,
      workspaceId: args.workspaceId,
      retention: args.retention,
    });

    return ControlPlaneChatSessionPresenter.projectDetail(session)[0] as ChatSessionDetail;
  }

  async updateSettings(args: UpdateControlPlaneChatSessionSettingsArgs): Promise<ChatSessionDetail> {
    const { sessionId, settings, ...engineInput } = args;
    const updated = await this.createEngine(engineInput).sessions.updateSettings(sessionId, settings);
    return ControlPlaneChatSessionPresenter.projectDetail(updated)[0] as ChatSessionDetail;
  }

  async renameSession(args: RenameControlPlaneChatSessionArgs): Promise<ChatSessionDetail> {
    const { sessionId, name, ...engineInput } = args;
    const updated = await this.createEngine(engineInput).sessions.rename(sessionId, name);
    return ControlPlaneChatSessionPresenter.projectDetail(updated)[0] as ChatSessionDetail;
  }

  async updatePinned(args: UpdatePinnedControlPlaneChatSessionArgs): Promise<ChatSessionDetail> {
    const { sessionId, pinned, ...engineInput } = args;
    const updated = await this.createEngine(engineInput).sessions.setPinned(sessionId, pinned);
    return ControlPlaneChatSessionPresenter.projectDetail(updated)[0] as ChatSessionDetail;
  }

  async updateArchived(args: UpdateArchivedControlPlaneChatSessionArgs): Promise<ChatSessionDetail> {
    const { sessionId, archived, ...engineInput } = args;
    const updated = await this.createEngine(engineInput).sessions.setArchived(sessionId, archived);
    return ControlPlaneChatSessionPresenter.projectDetail(updated)[0] as ChatSessionDetail;
  }

  async deleteSession(args: DeleteControlPlaneChatSessionArgs): Promise<{ deleted: boolean }> {
    this.assertNoActiveRun(args);
    const { sessionId, leaseOwner, ...engineInput } = args;
    const sessions = this.createEngine(engineInput).sessions;
    await this.assertNoLeaseConflict(sessions, sessionId, leaseOwner);
    return {
      deleted: await sessions.delete(sessionId),
    };
  }

  async resetSession(args: ResetControlPlaneChatSessionArgs): Promise<ChatSessionDetail> {
    this.assertNoActiveRun(args);
    const { sessionId, leaseOwner, ...engineInput } = args;
    const sessions = this.createEngine(engineInput).sessions;
    await this.assertNoLeaseConflict(sessions, sessionId, leaseOwner);
    const updated = await sessions.resetConversation(sessionId);
    return ControlPlaneChatSessionPresenter.projectDetail(updated)[0] as ChatSessionDetail;
  }

  async compactSession(args: CompactControlPlaneChatSessionArgs): Promise<ChatSessionDetail> {
    return await this.runService.startAndWait({
      address: this.runStreams.resolveAddress(args),
      ...this.runStreams.createLifecycle(args, {
        onSettled: () => this.startNextQueuedPrompt(args),
      }),
      onHeartbeat: async () => {
        await this.createEngine(args).sessions.refreshLease(args.sessionId, args.leaseOwner);
      },
      execute: async (run) => {
        const { sessionId, force = true, leaseOwner, ...engineInput } = args;
        const sessions = this.createEngine(engineInput).sessions;
        let leaseAcquired = false;
        let previousCompactionState: Pick<ChatSession, 'context' | 'archives'> | undefined;

        try {
          await this.assertNoLeaseConflict(sessions, sessionId, leaseOwner);
          const session = await sessions.acquireLease(sessionId, leaseOwner);
          leaseAcquired = true;
          const publisher = this.createRunEventPublisher(args, run);
          previousCompactionState = {
            context: session.context,
            archives: session.archives,
          };

          await sessions.markCompactionRunning(sessionId, { sourceHistory: session.history });
          const model = session.model ?? args.model ?? DEFAULT_OPENAI_MODEL;
          const providerRuntime = LlmProviderRuntimeService.resolve({
            model,
            apiKey: args.apiKey,
            credentialStorePath: args.credentialStorePath,
            preferApiKey: args.preferApiKey,
          });
          const compacted = await ConversationCompactionService.compact({
            history: session.history,
            runtime: {
              model,
              stateRoot: args.stateRoot,
              systemContext: args.systemContext,
            },
            session,
            archiveRepository: args.archiveRepository,
            force,
            summarizer: {
              apiKey: providerRuntime.apiKey,
              credentialStorePath: args.credentialStorePath,
              credentialSource: providerRuntime.credentialSource,
            },
            onStatusChange: publisher.publishActivity,
          });
          const updated = await sessions.applyCompactionResult(sessionId, compacted);
          return ControlPlaneChatSessionPresenter.projectDetail(updated)[0] as ChatSessionDetail;
        } catch (error) {
          if (previousCompactionState) {
            await sessions.restoreCompactionState(sessionId, previousCompactionState);
          }
          throw error;
        } finally {
          if (leaseAcquired) {
            await sessions.releaseLease(sessionId, leaseOwner);
          }
        }
      },
    });
  }

  readRunState(sessionAddress: ControlPlaneSessionAddress) {
    return this.runStreams.readState(sessionAddress);
  }

  async submitPrompt(args: SubmitChatPromptArgs) {
    return await this.runService.startAndWait(this.buildSubmitPromptRun(this.prepareSubmitPromptArgs(args)));
  }

  async submitPromptAsync(args: SubmitChatPromptArgs): Promise<ControlPlaneAcceptedSessionRun> {
    const preparedArgs = this.prepareSubmitPromptArgs(args);
    if (this.isRunning(preparedArgs) || await this.hasQueuedPrompts(preparedArgs)) {
      const queued = await this.enqueuePrompt(preparedArgs);
      if (!this.isRunning(preparedArgs)) {
        await this.startNextQueuedPrompt(preparedArgs);
      }
      return queued;
    }

    return await this.startPromptRun(preparedArgs);
  }

  submitDirectShellAsync(args: SubmitDirectShellArgs): ControlPlaneAcceptedSessionRun {
    return this.runService.start(this.buildDirectShellRun(args));
  }

  preflightDirectShell(command: string) {
    return ConversationDirectShellService.preflight(command);
  }

  async updateQueuedPrompt(args: UpdateQueuedChatPromptArgs): Promise<ChatSessionDetail> {
    const updated = await this.createEngine(args).sessions.updateQueuedPrompt(args.sessionId, {
      queueItemId: args.queueItemId,
      prompt: args.prompt,
    });
    this.publishQueueUpdated(args, updated);
    return ControlPlaneChatSessionPresenter.projectDetail(updated)[0] as ChatSessionDetail;
  }

  async deleteQueuedPrompt(args: DeleteQueuedChatPromptArgs): Promise<ChatSessionDetail> {
    const updated = await this.createEngine(args).sessions.deleteQueuedPrompt(args.sessionId, {
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
    listener: (event: ControlPlaneSessionEventEnvelope) => void,
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
        // Run identity, queue, and approval signals use the in-memory event bus.
        // Ordered conversation activities use subscribeRunEvents instead.
        (sink) => this.subscribeToEvents(args, (event) => {
          sink.push(event);
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
    workspaceId: string;
    stateRoot: string;
    signal?: AbortSignal;
  }): AsyncGenerator<ControlPlaneSessionsEventEnvelope> {
    const stream = RuntimeSubscriptionStream.fromSources<ControlPlaneSessionsEventEnvelope>({
      signal: args.signal,
      sources: [
        (sink) => {
          const listener = (event: ControlPlaneSessionsEventEnvelope) => {
            sink.push(event);
          };
          this.sessionEventBus.on(ControlPlaneChatSessionEventsController.workspaceAddressKey(args), listener);
          return () => {
            this.sessionEventBus.off(ControlPlaneChatSessionEventsController.workspaceAddressKey(args), listener);
          };
        },
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

  async *subscribeRunEvents(args: ControlPlaneSessionAddress & {
    runId: string;
    afterSequence?: number;
    signal?: AbortSignal;
  }): AsyncGenerator<ControlPlaneSessionRunEventEnvelope> {
    yield* this.runStreams.subscribe(args);
  }

  getPendingApproval(sessionAddress: ControlPlaneSessionAddress): ToolApprovalRequest | undefined {
    return this.runService.getPendingApproval(sessionAddress);
  }

  isRunning(sessionAddress: ControlPlaneSessionAddress): boolean {
    return this.runService.isRunning(sessionAddress);
  }

  cancelRun(sessionAddress: ControlPlaneSessionAddress, runId?: string): boolean {
    return this.runService.cancelRun(sessionAddress, runId);
  }

  resolvePendingApproval(
    sessionAddress: ControlPlaneSessionAddress,
    decision: ToolApprovalUserDecision,
    runId?: string,
  ): boolean {
    return this.runService.resolvePendingApproval(sessionAddress, decision, runId);
  }

  async readViews(args: ControlPlaneSessionReadArgs): Promise<ChatSessionView[]> {
    return (await this.createEngine(args).sessions.list())
      .flatMap((session) => ControlPlaneChatSessionPresenter.projectView(session));
  }

  async readDetail(args: ControlPlaneSessionReadArgs, id: string): Promise<ChatSessionDetail | undefined> {
    const session = await this.createEngine(args).sessions.read(id);
    return session ? ControlPlaneChatSessionPresenter.projectDetail(session)[0] : undefined;
  }

  async readTurnReview(args: ControlPlaneSessionReadArgs, sessionId: string, turnId: string): Promise<ChatTurnReview | undefined> {
    const session = await this.readDetail(args, sessionId);
    const turn = session?.turns.find((candidate) => candidate.id === turnId);
    if (!turn) {
      return undefined;
    }

    return ControlPlaneChatTurnReviewPresenter.load(turn.traceFile);
  }

  resolveFilePath(stateRoot: string, sessionId: string): string {
    return join(stateRoot, 'chat-sessions', `${sessionId}.json`);
  }

  private async startPromptRun(args: SubmitChatPromptArgs): Promise<ControlPlaneAcceptedSessionRun> {
    return await this.runService.startAndWaitForAcceptance(this.buildSubmitPromptRun(args));
  }

  private async enqueuePrompt(args: SubmitChatPromptArgs): Promise<ControlPlaneAcceptedSessionRun> {
    const queued = await this.createEngine(args).sessions.enqueuePrompt(args.sessionId, {
      prompt: args.prompt,
      agentProfileId: args.agentProfileId,
      agentSnapshot: args.agentSnapshot,
      systemContext: args.systemContext,
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

  private async hasQueuedPrompts(args: ControlPlaneSessionAddress & ControlPlaneSessionReadArgs): Promise<boolean> {
    return ((await this.createEngine(args).sessions.read(args.sessionId))?.queuedPrompts.length ?? 0) > 0;
  }

  private async startNextQueuedPrompt(args: ContinueChatPromptArgs): Promise<void> {
    if (this.isRunning(args)) {
      return;
    }

    const sessions = this.createEngine(args).sessions;
    const dequeued = await sessions.dequeueQueuedPrompt(args.sessionId);
    if (!dequeued.item) {
      return;
    }

    this.publishQueueUpdated(args, dequeued.session);
    try {
      await this.startPromptRun(this.prepareSubmitPromptArgs({
        ...args,
        prompt: dequeued.item.prompt,
        agentProfileId: dequeued.item.agentProfileId,
        agentSnapshot: dequeued.item.agentSnapshot,
        systemContext: dequeued.item.systemContext,
      }));
    } catch (error) {
      const restored = await sessions.enqueuePrompt(args.sessionId, {
        prompt: dequeued.item.prompt,
        agentProfileId: dequeued.item.agentProfileId,
        agentSnapshot: dequeued.item.agentSnapshot,
        systemContext: dequeued.item.systemContext,
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

  private createRunEventPublisher(address: ControlPlaneSessionAddress, run: ConversationRunContext) {
    const publisher = ControlPlaneChatSessionEventsController.createSessionEventPublisher({
      eventBus: this.sessionEventBus,
      workspaceId: address.workspaceId,
      sessionId: address.sessionId,
    });

    return {
      ...publisher,
      publishActivity: run.publishActivity,
      publishActivities: (activities: ConversationActivity[]) => activities.forEach(run.publishActivity),
    };
  }

  private buildSubmitPromptRun(args: SubmitChatPromptArgs) {
    return {
      address: this.runStreams.resolveAddress(args),
      ...this.runStreams.createLifecycle(args, {
        onAccepted: async (run) => {
          await this.createEngine(args).sessions.acceptUserMessage(args.sessionId, {
            runId: run.runId,
            prompt: args.prompt,
            leaseOwner: args.leaseOwner,
          });
        },
        onSettled: () => this.startNextQueuedPrompt(args),
      }),
      onHeartbeat: async () => {
        await this.createEngine(args).sessions.refreshLease(args.sessionId, args.leaseOwner);
      },
      execute: async (run: ConversationRunContext) => {
        const result = process.env.HEDDLE_BROWSER_INTEGRATION_FAKE_AGENT === '1'
          ? await ControlPlaneChatSessionBrowserIntegrationFake.run({
            ...args,
            runId: run.runId,
            publishActivity: run.publishActivity,
          })
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
      onError: async (error: unknown, run: ConversationRunContext) => {
        await this.persistRunFailureMessage(args, run, error);
      },
    };
  }

  private buildContinuePromptRun(args: ContinueChatPromptArgs) {
    return {
      address: this.runStreams.resolveAddress(args),
      ...this.runStreams.createLifecycle(args, {
        onSettled: () => this.startNextQueuedPrompt(args),
      }),
      onHeartbeat: async () => {
        await this.createEngine(args).sessions.refreshLease(args.sessionId, args.leaseOwner);
      },
      execute: async (run: ConversationRunContext) => {
        if (process.env.HEDDLE_BROWSER_INTEGRATION_FAKE_AGENT === '1') {
          const session = await this.createEngine(args).sessions.require(args.sessionId);
          if (!session.history.length || !session.lastContinuePrompt) {
            throw new Error('There is no interrupted or prior run to continue yet.');
          }

          return await ControlPlaneChatSessionBrowserIntegrationFake.run({
            ...args,
            runId: run.runId,
            publishActivity: run.publishActivity,
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
      onError: async (error: unknown, run: ConversationRunContext) => {
        await this.persistRunFailureMessage(args, run, error);
      },
    };
  }

  private buildDirectShellRun(args: SubmitDirectShellArgs) {
    return {
      address: this.runStreams.resolveAddress(args),
      ...this.runStreams.createLifecycle(args, {
        onSettled: () => this.startNextQueuedPrompt(args),
      }),
      onHeartbeat: async () => {
        await this.createEngine(args).sessions.refreshLease(args.sessionId, args.leaseOwner);
      },
      execute: async (run: ConversationRunContext) => {
        const publisher = this.createRunEventPublisher(args, run);
        const sessions = this.createEngine(args).sessions;
        const session = await sessions.require(args.sessionId);
        await this.assertNoLeaseConflict(sessions, args.sessionId, args.leaseOwner);
        await sessions.acquireLease(args.sessionId, args.leaseOwner);

        try {
          const model = session.model ?? args.model ?? DEFAULT_OPENAI_MODEL;
          const providerRuntime = LlmProviderRuntimeService.resolve({
            model,
            apiKey: args.apiKey,
            credentialStorePath: args.credentialStorePath,
            preferApiKey: args.preferApiKey,
          });
          const result = await ConversationDirectShellService.execute({
            sessionId: args.sessionId,
            runId: run.runId,
            command: args.command,
            model,
            workspaceRoot: args.workspaceRoot,
            stateRoot: args.stateRoot,
            archiveRepository: args.archiveRepository,
            systemContext: args.systemContext,
            riskAccepted: args.riskAccepted,
            summarizer: {
              apiKey: providerRuntime.apiKey,
              credentialStorePath: args.credentialStorePath,
              credentialSource: providerRuntime.credentialSource,
            },
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
            session: ControlPlaneChatSessionPresenter.projectDetail(await sessions.require(args.sessionId))[0] ?? null,
          };
        } finally {
          await sessions.releaseLease(args.sessionId, args.leaseOwner);
        }
      },
      onError: async (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        await this.createEngine(args).sessions.appendMessage(args.sessionId, {
          id: `direct-shell-error-${Date.now()}`,
          role: 'assistant',
          text: `Direct shell execution failed:\n${message}`,
        });
      },
    };
  }

  private async runEngineTurn(
    args: ContinueChatPromptArgs,
    runContext: ConversationRunContext,
    run: (input: {
      engine: ConversationEngine;
      host: ConversationEngineHost;
      abortSignal: AbortSignal;
      shouldStop: () => boolean;
    }) => ReturnType<ConversationEngine['turns']['submit']>,
  ) {
    const publisher = this.createRunEventPublisher(args, runContext);

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

  private async persistRunFailureMessage(
    args: ContinueChatPromptArgs,
    run: ConversationRunContext,
    error: unknown,
  ): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    await this.createEngine(args).sessions.markAcceptedUserMessageFailed(args.sessionId, {
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
              publisher.publishApprovalUpdated(request);
            },
          });
          this.runService.clearPendingApproval(args);
          publisher.publishApprovalUpdated(null);
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

  private async assertNoLeaseConflict(
    sessions: ConversationEngine['sessions'],
    sessionId: string,
    leaseOwner: ChatSessionLeaseOwner,
  ): Promise<void> {
    const conflict = await sessions.getLeaseConflict(sessionId, leaseOwner);
    if (conflict) {
      throw new Error(conflict);
    }
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

export const controlPlaneChatSessionsController = new ControlPlaneChatSessionsController();
