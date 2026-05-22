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
import {
  ToolApprovalPolicies,
  ToolApprovalService,
  type ToolApprovalRequest,
  type ToolApprovalUserDecision,
} from '@/core/approvals/index.js';
import { createConversationEngine } from '@/core/chat/engine/conversation-engine.js';
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
    approval: ToolApprovalRequest;
    resolve: (decision: ToolApprovalUserDecision) => void;
  }>();
  private readonly inFlightRuns = new Map<string, AbortController>();

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

  async submitPrompt(args: SubmitChatPromptArgs) {
    if (process.env.HEDDLE_BROWSER_INTEGRATION_FAKE_AGENT === '1') {
      return await this.runFakeBrowserIntegrationSessionPrompt(args);
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

  async *subscribeLiveEvents(args: {
    stateRoot: string;
    sessionId: string;
    signal?: AbortSignal;
  }): AsyncGenerator<ControlPlaneSessionEventEnvelope> {
    const queue = new ControlPlaneSessionEventQueue();

    // Live LLM/tool/compaction updates arrive through the in-memory event bus.
    // This is the path that streams assistant text to the client during a run;
    // it does not touch the session file for each model delta.
    const unsubscribe = this.subscribeToEvents(args.sessionId, (event) => {
      queue.push({
        ...event,
        type: 'session.event',
      });
    });

    // Closing the browser subscription closes the queue, which lets the async
    // iterator below exit and release the EventEmitter listener/file watcher.
    const abort = () => queue.close();
    args.signal?.addEventListener('abort', abort, { once: true });

    let watcher: ReturnType<typeof watch> | undefined;
    try {
      // File changes represent durable session persistence, usually after a
      // turn finishes or settings/session metadata are saved. They are not the
      // source of token streaming; they only tell the client to refetch the
      // persisted session snapshot.
      watcher = watch(this.resolveFilePath(args.stateRoot, args.sessionId), { persistent: false }, () => {
        queue.push({
          type: 'session.updated',
          sessionId: args.sessionId,
          timestamp: new Date().toISOString(),
        });
      });
    } catch {
      // A newly selected or newly created session may not have a watchable file
      // yet. Keep the subscription alive so later live events can still flow.
      queue.push({
        type: 'waiting',
        sessionId: args.sessionId,
        timestamp: new Date().toISOString(),
      });
    }

    try {
      // tRPC consumes this AsyncGenerator and forwards each envelope to the
      // browser as a subscription payload.
      for await (const event of queue) {
        yield event;
      }
    } finally {
      unsubscribe();
      watcher?.close();
      args.signal?.removeEventListener('abort', abort);
      queue.close();
    }
  }

  getPendingApproval(sessionId: string): ToolApprovalRequest | undefined {
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
    decision: ToolApprovalUserDecision,
  ): boolean {
    const pending = this.pendingApprovals.get(sessionId);
    if (!pending) {
      return false;
    }

    this.pendingApprovals.delete(sessionId);
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
        host: this.createEngineHost(args, publisher),
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

  private createEngineHost(args: ControlPlaneSessionReadArgs & { sessionId: string }, publisher: ControlPlaneTurnPublisher): ConversationEngineHost {
    const sessionId = args.sessionId;
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
              this.pendingApprovals.set(sessionId, {
                approval: request,
                resolve,
              });
            },
          });
          this.pendingApprovals.delete(sessionId);
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
    await this.emitBrowserIntegrationStreamPreview(args.sessionId, assistantText);
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

  private async emitBrowserIntegrationStreamPreview(sessionId: string, assistantText: string): Promise<void> {
    // The browser-integration fake has to emit a real live activity before its
    // final mutation result so web-v2 can regression-test incremental streaming.
    const publisher = ControlPlaneChatSessionEventsController.createSessionEventPublisher({
      eventBus: this.sessionEventBus,
      sessionId,
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
}

export const controlPlaneChatSessionsController = new ControlPlaneChatSessionsController();

/**
 * Per-subscription delivery queue for control-plane session events.
 *
 * The controller uses EventEmitter for in-process fanout, while tRPC
 * subscriptions consume an AsyncIterable. This queue is the transport adapter
 * between those two shapes: it buffers events when the browser is not awaiting
 * the next item yet, wakes pending readers when an event arrives, and closes
 * cleanly when the subscription is aborted.
 *
 * Boundary: this class must stay transport/infrastructure-only. It should not
 * inspect or transform conversation activities; event vocabulary belongs to the
 * conversation engine and control-plane event publisher.
 */
class ControlPlaneSessionEventQueue implements AsyncIterable<ControlPlaneSessionEventEnvelope> {
  private readonly events: ControlPlaneSessionEventEnvelope[] = [];
  private readonly waiters: Array<(event: ControlPlaneSessionEventEnvelope | undefined) => void> = [];
  private closed = false;

  push(event: ControlPlaneSessionEventEnvelope): void {
    if (this.closed) {
      return;
    }

    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(event);
      return;
    }

    this.events.push(event);
  }

  close(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.waiters.splice(0).forEach((waiter) => waiter(undefined));
  }

  async *[Symbol.asyncIterator](): AsyncIterator<ControlPlaneSessionEventEnvelope> {
    while (!this.closed || this.events.length > 0) {
      const event = this.events.shift() ?? await new Promise<ControlPlaneSessionEventEnvelope | undefined>((resolve) => {
        this.waiters.push(resolve);
      });
      if (!event) {
        break;
      }

      yield event;
    }
  }
}
