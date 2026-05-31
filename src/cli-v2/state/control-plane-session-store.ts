import type { ControlPlaneProxyClient } from '@/client-shared/api/proxy.js';
import { ClientSharedSessionActivityService } from '@/client-shared/services/session-activities/index.js';
import type { ClientSharedSessionPlan } from '@/client-shared/services/session-activities/index.js';
import { ClientSharedSessionMessageService } from '@/client-shared/services/session-messages/index.js';
import {
  SessionActivityService,
  type ControlPlaneSessionLatestUpdate,
} from '../services/activities/session-activity-service.js';
import {
  ControlPlaneSessionApiService,
  type ControlPlaneSessionCreateInput,
} from '../services/sessions/control-plane-session-api-service.js';
import { SlashCommandAutocompleteService } from '../services/slash-commands/index.js';
import { ControlPlaneSessionSubscriptionService } from '../services/sessions/control-plane-session-subscription-service.js';
import {
  AssistantStreamBufferService,
  type AssistantStreamUpdate,
} from '../services/sessions/assistant-stream-buffer-service.js';
import {
  SessionRunStatePollerService,
  type SessionRunStatePollAddress,
} from '../services/sessions/session-run-state-poller-service.js';
import type {
  ControlPlaneApprovalDecision,
  ControlPlaneModelOptions,
  ControlPlanePendingApproval,
  ControlPlaneSessionDetail,
  ControlPlaneSessionEventEnvelope,
  ControlPlaneSessionRuntimeContext,
  ControlPlaneSessionView,
  ControlPlaneSlashCommandCatalog,
  ControlPlaneSlashCommandHint,
  ControlPlaneSlashCommandResult,
} from '@/client-shared/api/types.js';

const ASSISTANT_STREAM_RENDER_INTERVAL_MS = 75;
const RUN_STATE_POLL_INTERVAL_MS = 750;

export type ControlPlaneSessionStoreOptions = {
  client: ControlPlaneProxyClient;
  defaultModel?: string;
  maxSteps?: number;
  searchIgnoreDirs?: string[];
  systemContext?: string;
  apiKey?: string;
  preferApiKey?: boolean;
};

export type ControlPlaneSessionStoreStartInput = {
  workspaceId?: string;
  sessionId?: string;
};

export type ControlPlaneSessionStoreSnapshot = {
  workspaceId?: string;
  sessions: ControlPlaneSessionView[];
  activeSessionId?: string;
  activeSession: ControlPlaneSessionDetail;
  runtimeContext?: ControlPlaneSessionRuntimeContext;
  modelOptions?: ControlPlaneModelOptions;
  pendingApproval: ControlPlanePendingApproval;
  loading: boolean;
  submitting: boolean;
  approvalResolving: boolean;
  running: boolean;
  cancelling: boolean;
  streamConnected: boolean;
  liveStatus?: string;
  activePlan?: ClientSharedSessionPlan;
  latestUpdate?: ControlPlaneSessionLatestUpdate;
  slashCommandCatalog?: ControlPlaneSlashCommandCatalog;
  commandResults: ControlPlaneSlashCommandResult[];
  error?: string;
};

const INITIAL_SNAPSHOT: ControlPlaneSessionStoreSnapshot = {
  sessions: [],
  activeSession: null,
  runtimeContext: undefined,
  modelOptions: undefined,
  pendingApproval: null,
  loading: false,
  submitting: false,
  approvalResolving: false,
  running: false,
  cancelling: false,
  streamConnected: false,
  commandResults: [],
};

/**
 * Owns cli-v2 control-plane session state over the shared tRPC API.
 *
 * This is the non-React counterpart to web-v2's focused session hooks: it loads
 * the selected workspace/session, subscribes to live updates, keeps transient
 * conversation messages coherent, and exposes terminal intent methods.
 * Shared activity policy stays in client-shared; this store owns only cli-v2
 * state mutation and terminal workflow coordination.
 */
export class ControlPlaneSessionStore {
  private readonly api: ControlPlaneSessionApiService;
  private readonly listeners = new Set<() => void>();
  private snapshotValue: ControlPlaneSessionStoreSnapshot = INITIAL_SNAPSHOT;
  private readonly subscriptions: ControlPlaneSessionSubscriptionService;
  private readonly assistantStreamBuffer: AssistantStreamBufferService;
  private readonly runStatePoller: SessionRunStatePollerService;

  constructor(options: ControlPlaneSessionStoreOptions) {
    this.api = new ControlPlaneSessionApiService(options);
    this.subscriptions = new ControlPlaneSessionSubscriptionService({
      client: options.client,
      onSessionsUpdated: () => {
        void this.refreshSessions().catch((error) => this.setSnapshot({ error: formatError(error) }));
      },
      onSessionEvent: (workspaceId, event) => this.applySessionEvent(workspaceId, event),
      onSessionListError: (error) => this.setSnapshot({ error: error.message }),
      onSessionStreamError: (error) => {
        this.setSnapshot({ streamConnected: false, liveStatus: error.message });
      },
      onSessionStreamStarted: () => {
        this.setSnapshot({ streamConnected: true });
      },
      onSessionStreamComplete: () => {
        this.setSnapshot({ streamConnected: false });
      },
    });
    this.assistantStreamBuffer = new AssistantStreamBufferService({
      renderIntervalMs: ASSISTANT_STREAM_RENDER_INTERVAL_MS,
      canApply: (update) => (
        this.isActiveSessionAddress(update.workspaceId, update.sessionId) &&
        this.isRunAcceptingLiveAssistantStream()
      ),
      apply: (update) => this.applyAssistantStreamUpdate(update),
    });
    this.runStatePoller = new SessionRunStatePollerService({
      intervalMs: RUN_STATE_POLL_INTERVAL_MS,
      getAddress: () => this.resolveRunStatePollAddress(),
      isEnabled: () => this.shouldPollRunState(),
      poll: (address) => this.pollRunState(address),
      onError: (error) => this.setSnapshot({ error: formatError(error) }),
    });
  }

  getSnapshot = (): ControlPlaneSessionStoreSnapshot => this.snapshotValue;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  async start(input: ControlPlaneSessionStoreStartInput = {}): Promise<void> {
    this.setSnapshot({ loading: true, error: undefined });
    try {
      const workspaceId = await this.api.resolveWorkspaceId(input.workspaceId);
      const modelOptions = await this.api.getModelOptions();

      this.setSnapshot({ workspaceId, modelOptions });
      await this.refreshSlashCommandCatalog(workspaceId);
      this.subscriptions.subscribeToSessionList(workspaceId);
      const sessions = await this.refreshSessions();
      const sessionId = input.sessionId ?? sessions[0]?.id ?? (await this.createSession()).id;
      await this.selectSession(sessionId);
    } catch (error) {
      this.setSnapshot({ error: formatError(error), loading: false });
    }
  }

  dispose(): void {
    this.subscriptions.dispose();
    this.assistantStreamBuffer.dispose();
    this.runStatePoller.dispose();
  }

  async refreshSessions(): Promise<ControlPlaneSessionView[]> {
    const workspaceId = this.requireWorkspaceId();
    const sessions = await this.api.listSessions(workspaceId);
    this.setSnapshot({ sessions });
    return sessions;
  }

  async createSession(input: ControlPlaneSessionCreateInput = {}): Promise<ControlPlaneSessionView> {
    const workspaceId = this.requireWorkspaceId();
    const session = await this.api.createSession(workspaceId, input);
    await this.refreshSessions();
    return session;
  }

  async selectSession(sessionId: string): Promise<void> {
    const workspaceId = this.requireWorkspaceId();
    this.assistantStreamBuffer.reset();
    this.setSnapshot({
      activeSessionId: sessionId,
      activeSession: null,
      runtimeContext: undefined,
      pendingApproval: null,
      liveStatus: undefined,
      activePlan: undefined,
      latestUpdate: undefined,
      error: undefined,
      loading: true,
      streamConnected: false,
    });

    try {
      const session = await this.api.getSession(workspaceId, sessionId);
      const runtimeContext = await this.api.getRuntimeContext(workspaceId, sessionId);
      const running = await this.api.getRunning(workspaceId, sessionId);
      this.setSnapshot({
        activeSession: session,
        runtimeContext,
        running: running.running,
        loading: false,
      });
      await this.refreshPendingApproval(sessionId);
      this.subscriptions.subscribeToSessionEvents(workspaceId, sessionId);
    } catch (error) {
      this.setSnapshot({ error: formatError(error), loading: false });
    }
  }

  async submitPrompt(prompt: string): Promise<void> {
    const trimmed = prompt.trim();
    if (!trimmed || this.snapshotValue.submitting) {
      return;
    }

    if (SlashCommandAutocompleteService.isSlashDraft(trimmed)) {
      await this.executeSlashCommand(trimmed);
      return;
    }

    if (this.snapshotValue.running) {
      this.setSnapshot({
        latestUpdate: {
          label: 'Run already in progress',
          detail: 'waiting for current run to finish',
          tone: 'warning',
        },
      });
      return;
    }

    const workspaceId = this.requireWorkspaceId();
    const sessionId = this.requireActiveSessionId();
    this.setSnapshot((current) => ({
      submitting: true,
      running: true,
      error: undefined,
      activePlan: undefined,
      liveStatus: current.streamConnected
        ? 'Heddle is working...'
        : 'Heddle is working... reconnecting live stream if needed.',
      latestUpdate: {
        label: 'Thinking',
        detail: 'waiting for model or tool activity',
        tone: 'info',
      },
    }));

    try {
      const result = await this.api.sendPromptAsync({
        workspaceId,
        sessionId,
        prompt: trimmed,
      });
      this.assistantStreamBuffer.reset();
      this.setSnapshot({
        submitting: false,
        running: true,
        liveStatus: this.snapshotValue.streamConnected
          ? 'Heddle is working...'
          : 'Heddle is working... reconnecting live stream if needed.',
        latestUpdate: {
          label: 'Run accepted',
          detail: result.runId,
          tone: 'info',
        },
      });
      await this.refreshSession(sessionId, { silent: true });
      await this.refreshSessions();
      await this.refreshPendingApproval(sessionId);
    } catch (error) {
      if (isRunAlreadyInProgressError(error)) {
        this.setSnapshot({
          error: undefined,
          running: true,
          submitting: false,
          liveStatus: this.snapshotValue.streamConnected
            ? 'A run is already in progress for this session.'
            : 'A run is already in progress for this session. Reconnecting live stream if needed.',
          latestUpdate: {
            label: 'Run already in progress',
            detail: 'waiting for current run to finish',
            tone: 'warning',
          },
        });
        return;
      }

      this.setSnapshot({
        error: formatError(error),
        running: false,
        submitting: false,
        liveStatus: undefined,
      });
      await this.refreshSession(sessionId, { silent: true }).catch(() => undefined);
      this.assistantStreamBuffer.reset();
    }
  }

  getSlashCommandHints(draft: string): ControlPlaneSlashCommandHint[] {
    return SlashCommandAutocompleteService.filterHints(draft, this.snapshotValue.slashCommandCatalog?.hints ?? []);
  }

  completeSlashCommandDraft(draft: string): string | undefined {
    return SlashCommandAutocompleteService.complete(draft, this.snapshotValue.slashCommandCatalog?.hints ?? []);
  }

  async selectModelFromPicker(modelId: string): Promise<void> {
    await this.executeSlashCommand(`/model ${modelId}`);
  }

  async selectSessionFromPicker(sessionId: string): Promise<void> {
    await this.executeSlashCommand(`/session switch ${sessionId}`);
  }

  async selectReasoningFromPicker(reasoningEffort: string): Promise<void> {
    await this.executeSlashCommand(reasoningEffort === 'default' ? '/reasoning default' : `/reasoning ${reasoningEffort}`);
  }

  async cancelRun(): Promise<void> {
    const workspaceId = this.requireWorkspaceId();
    const sessionId = this.requireActiveSessionId();
    this.setSnapshot({
      cancelling: true,
      error: undefined,
      liveStatus: 'Stop requested. Waiting for the current step to settle...',
      latestUpdate: {
        label: 'Stop requested',
        tone: 'warning',
      },
    });

    try {
      const result = await this.api.cancelRun(workspaceId, sessionId);
      await this.refreshPendingApproval(sessionId);
      const running = await this.api.getRunning(workspaceId, sessionId);
      this.setSnapshot({
        running: result.cancelled ? running.running : false,
        cancelling: false,
        liveStatus: result.cancelled && running.running ? this.snapshotValue.liveStatus : undefined,
        latestUpdate: {
          label: result.cancelled ? 'Stop request accepted' : 'No active run to stop',
          tone: result.cancelled ? 'warning' : 'info',
        },
      });
    } catch (error) {
      this.setSnapshot({
        error: formatError(error),
        cancelling: false,
        liveStatus: undefined,
      });
    }
  }

  async resolvePendingApproval(decision: ControlPlaneApprovalDecision): Promise<void> {
    const workspaceId = this.requireWorkspaceId();
    const sessionId = this.requireActiveSessionId();
    this.setSnapshot({
      approvalResolving: true,
      error: undefined,
      latestUpdate: {
        label: 'Resolving approval',
        tone: 'info',
      },
    });

    try {
      const result = await this.api.resolvePendingApproval(workspaceId, sessionId, decision);
      if (!result.resolved) {
        throw new Error('No pending approval found for this session.');
      }
      await this.refreshPendingApproval(sessionId);
      this.setSnapshot({
        approvalResolving: false,
        latestUpdate: {
          label: 'Approval resolved',
          detail: decision.type,
          tone: 'info',
        },
      });
    } catch (error) {
      this.setSnapshot({
        approvalResolving: false,
        error: formatError(error),
      });
    }
  }

  private async refreshSession(sessionId: string, options: { silent?: boolean } = {}): Promise<void> {
    const workspaceId = this.requireWorkspaceId();
    if (!options.silent) {
      this.setSnapshot({ loading: true });
    }

    try {
      const next = await this.api.getSession(workspaceId, sessionId);
      const runtimeContext = await this.api.getRuntimeContext(workspaceId, sessionId);
      this.setSnapshot((current) => ({
        activeSession: options.silent
          ? ClientSharedSessionMessageService.mergeTransientMessages(current.activeSession, next)
          : next,
        runtimeContext,
        loading: false,
      }));
    } catch (error) {
      this.setSnapshot({ error: formatError(error), loading: false });
    }
  }

  private async refreshPendingApproval(sessionId: string): Promise<void> {
    const workspaceId = this.requireWorkspaceId();
    const pendingApproval = await this.api.getPendingApproval(workspaceId, sessionId);
    this.setSnapshot({ pendingApproval });
  }

  private async refreshSlashCommandCatalog(workspaceId: string): Promise<void> {
    const slashCommandCatalog = await this.api.getSlashCommandCatalog(workspaceId);
    this.setSnapshot({ slashCommandCatalog });
  }

  private async executeSlashCommand(command: string): Promise<void> {
    if (this.snapshotValue.running) {
      this.setSnapshot({
        commandResults: this.appendCommandResult({
          handled: true,
          kind: 'message',
          message: 'A run is already in progress. Wait for it to finish before running a slash command.',
        }),
      });
      return;
    }

    const workspaceId = this.requireWorkspaceId();
    const sessionId = this.requireActiveSessionId();
    this.setSnapshot({ submitting: true, error: undefined });

    try {
      const result = await this.api.executeSlashCommand({ workspaceId, sessionId, command });
      await this.applySlashCommandResult(workspaceId, result);
    } catch (error) {
      this.setSnapshot({ error: formatError(error) });
    } finally {
      this.setSnapshot({ submitting: false });
    }
  }

  private async applySlashCommandResult(workspaceId: string, result: ControlPlaneSlashCommandResult): Promise<void> {
    if (result.handled === false) {
      return;
    }

    this.setSnapshot({
      commandResults: this.appendCommandResult(result),
    });

    const resultSessionId = 'sessionId' in result ? result.sessionId : undefined;
    if (resultSessionId && resultSessionId !== this.snapshotValue.activeSessionId) {
      await this.refreshSessions();
      await this.selectSession(resultSessionId);
    } else if (this.snapshotValue.activeSessionId) {
      const sessions = await this.refreshSessions();
      if (sessions.some((session) => session.id === this.snapshotValue.activeSessionId)) {
        await this.refreshSession(this.snapshotValue.activeSessionId, { silent: true });
      } else {
        await this.selectSession(sessions[0]?.id ?? (await this.createSession()).id);
      }
    }

    if (result.kind === 'continue') {
      const sessionId = resultSessionId ?? this.requireActiveSessionId();
      await this.continueSession(workspaceId, sessionId);
      return;
    }

    if (result.kind === 'execute') {
      await this.submitAgentPrompt(result.prompt);
    }
  }

  private async continueSession(workspaceId: string, sessionId: string): Promise<void> {
    this.setSnapshot({
      running: true,
      activePlan: undefined,
      liveStatus: 'Heddle is continuing from the current transcript...',
    });
    await this.api.continueSession(workspaceId, sessionId);
    await this.refreshSession(sessionId, { silent: true });
    await this.refreshSessions();
  }

  private async submitAgentPrompt(prompt: string): Promise<void> {
    const workspaceId = this.requireWorkspaceId();
    const sessionId = this.requireActiveSessionId();
    await this.api.sendPromptAsync({ workspaceId, sessionId, prompt });
    this.setSnapshot({
      running: true,
      activePlan: undefined,
      liveStatus: this.snapshotValue.streamConnected
        ? 'Heddle is working...'
        : 'Heddle is working... reconnecting live stream if needed.',
    });
    await this.refreshSession(sessionId, { silent: true });
    await this.refreshSessions();
  }

  private appendCommandResult(result: ControlPlaneSlashCommandResult): ControlPlaneSlashCommandResult[] {
    return [...this.snapshotValue.commandResults, result].slice(-5);
  }

  private applySessionEvent(workspaceId: string, event: ControlPlaneSessionEventEnvelope): void {
    if (!this.isActiveSessionAddress(workspaceId, event.sessionId)) {
      return;
    }

    if (event.type === 'waiting') {
      this.setSnapshot({
        liveStatus: 'Waiting for the session event stream...',
        latestUpdate: {
          label: 'Waiting for session events',
          tone: 'info',
        },
      });
      return;
    }

    if (event.type === 'session.updated') {
      void this.refreshSession(event.sessionId, { silent: true });
      return;
    }

    if (event.type !== 'session.event') {
      return;
    }

    event.activities.forEach((activity) => {
      ClientSharedSessionActivityService.applyActivity(activity, {
        onAssistantStream: (streamActivity) => {
          this.assistantStreamBuffer.push({
            workspaceId,
            sessionId: event.sessionId,
            text: streamActivity.text,
            done: streamActivity.done,
          });
        },
        onRunStarted: (runActivity, liveStatus) => {
          this.setSnapshot({
            running: true,
            liveStatus,
            latestUpdate: SessionActivityService.resolveLatestUpdate(runActivity),
          });
        },
        onRunFinished: (runActivity, liveStatus) => {
          this.assistantStreamBuffer.flush();
          this.setSnapshot({
            running: false,
            ...(liveStatus !== undefined ? { liveStatus } : {}),
            latestUpdate: SessionActivityService.resolveLatestUpdate(runActivity),
          });
          void this.refreshSession(event.sessionId, { silent: true });
          void this.refreshSessions();
        },
        onPendingApprovalChanged: () => {
          void this.refreshPendingApproval(event.sessionId);
        },
        onPlanUpdated: (plan) => {
          this.setSnapshot({ activePlan: plan });
        },
        onPlanCleared: () => {
          this.setSnapshot({ activePlan: undefined });
        },
        onLiveStatus: (statusActivity, liveStatus) => {
          const latestUpdate = SessionActivityService.resolveLatestUpdate(statusActivity);
          if (liveStatus === undefined && latestUpdate === undefined) {
            return;
          }

          this.setSnapshot({
            ...(liveStatus !== undefined ? { liveStatus } : {}),
            ...(latestUpdate !== undefined ? { latestUpdate } : {}),
          });
        },
      });
    });
  }

  private applyAssistantStreamUpdate(update: AssistantStreamUpdate): void {
    this.setSnapshot((current) => ({
      activeSession: ClientSharedSessionMessageService.upsertLiveAssistantMessage(
        current.activeSession,
        update.text,
        update.done,
      ),
      ...(!update.done ? { liveStatus: 'Receiving assistant response...' } : {}),
    }));
  }

  private isActiveSessionAddress(workspaceId: string, sessionId: string): boolean {
    return this.snapshotValue.workspaceId === workspaceId && this.snapshotValue.activeSessionId === sessionId;
  }

  private isRunAcceptingLiveAssistantStream(): boolean {
    return this.snapshotValue.running || this.snapshotValue.submitting;
  }

  private requireWorkspaceId(): string {
    const workspaceId = this.snapshotValue.workspaceId;
    if (!workspaceId) {
      throw new Error('Control-plane workspace is not loaded.');
    }
    return workspaceId;
  }

  private requireActiveSessionId(): string {
    const sessionId = this.snapshotValue.activeSessionId;
    if (!sessionId) {
      throw new Error('No active control-plane session is selected.');
    }
    return sessionId;
  }

  private setSnapshot(
    next:
      | Partial<ControlPlaneSessionStoreSnapshot>
      | ((current: ControlPlaneSessionStoreSnapshot) => Partial<ControlPlaneSessionStoreSnapshot>),
  ): void {
    const patch = typeof next === 'function' ? next(this.snapshotValue) : next;
    this.snapshotValue = {
      ...this.snapshotValue,
      ...patch,
    };
    this.runStatePoller.sync();
    this.listeners.forEach((listener) => listener());
  }

  private shouldPollRunState(): boolean {
    return this.snapshotValue.running || this.snapshotValue.submitting || this.snapshotValue.cancelling;
  }

  private resolveRunStatePollAddress(): SessionRunStatePollAddress | undefined {
    const { workspaceId, activeSessionId } = this.snapshotValue;
    return workspaceId && activeSessionId ? { workspaceId, sessionId: activeSessionId } : undefined;
  }

  private async pollRunState({ workspaceId, sessionId }: SessionRunStatePollAddress): Promise<void> {
    const runState = await this.api.getRunState(workspaceId, sessionId);
    if (!this.isActiveSessionAddress(workspaceId, sessionId)) {
      return;
    }

    this.setSnapshot({
      pendingApproval: runState.pendingApproval,
      running: runState.running,
      runtimeContext: this.snapshotValue.runtimeContext
        ? { ...this.snapshotValue.runtimeContext, running: runState.running }
        : this.snapshotValue.runtimeContext,
      cancelling: runState.running ? this.snapshotValue.cancelling : false,
      latestUpdate: runState.pendingApproval
        ? {
          label: 'Approval requested',
          detail: SessionActivityService.formatPendingApprovalLabel(runState.pendingApproval),
          tone: 'warning',
        }
        : this.snapshotValue.latestUpdate,
    });

    if (runState.running) {
      return;
    }

    if (this.snapshotValue.submitting) {
      this.setSnapshot({
        liveStatus: 'Waiting for run acceptance...',
        latestUpdate: {
          label: 'Run starting',
          detail: 'waiting for server acceptance',
          tone: 'info',
        },
      });
      return;
    }

    await this.refreshSession(sessionId, { silent: true });
    await this.refreshSessions();
    this.setSnapshot({
      submitting: false,
      liveStatus: undefined,
      activePlan: undefined,
      latestUpdate: {
        label: 'Run finished',
        tone: 'success',
      },
    });
  }
}

function isRunAlreadyInProgressError(error: unknown): boolean {
  return formatError(error).includes('A run is already in progress for this session.');
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
