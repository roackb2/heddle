import type { ControlPlaneProxyClient } from '@/client-shared/api/proxy.js';
import { ClientSharedSessionMessageController } from '@/client-shared/controllers/session-messages/index.js';
import type {
  ControlPlaneApprovalDecision,
  ControlPlanePendingApproval,
  ControlPlaneSessionDetail,
  ControlPlaneSessionEventEnvelope,
  ControlPlaneSessionView,
  ControlPlaneSessionsEventEnvelope,
  RouterInputs,
} from '@/client-shared/api/types.js';

type SubscriptionHandle = {
  unsubscribe: () => void;
};

type SessionCreateInput = Exclude<NonNullable<RouterInputs['controlPlane']['sessionCreate']>, void>;
type SessionSendPromptInput = RouterInputs['controlPlane']['sessionSendPrompt'];

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
  pendingApproval: ControlPlanePendingApproval;
  loading: boolean;
  submitting: boolean;
  running: boolean;
  cancelling: boolean;
  streamConnected: boolean;
  liveStatus?: string;
  error?: string;
};

const INITIAL_SNAPSHOT: ControlPlaneSessionStoreSnapshot = {
  sessions: [],
  activeSession: null,
  pendingApproval: null,
  loading: false,
  submitting: false,
  running: false,
  cancelling: false,
  streamConnected: false,
};

/**
 * Owns cli-v2 control-plane session state over the shared tRPC API.
 *
 * This is the non-React counterpart to web-v2's focused session hooks: it loads
 * the selected workspace/session, subscribes to live updates, keeps transient
 * conversation messages coherent, and exposes terminal intent methods.
 */
export class ControlPlaneSessionStore {
  private readonly client: ControlPlaneProxyClient;
  private readonly options: Omit<ControlPlaneSessionStoreOptions, 'client'>;
  private readonly listeners = new Set<() => void>();
  private snapshotValue: ControlPlaneSessionStoreSnapshot = INITIAL_SNAPSHOT;
  private sessionsSubscription?: SubscriptionHandle;
  private sessionSubscription?: SubscriptionHandle;
  private pendingApprovalPoll?: ReturnType<typeof setInterval>;
  private subscriptionAddress?: { workspaceId: string; sessionId: string };

  constructor(options: ControlPlaneSessionStoreOptions) {
    this.client = options.client;
    this.options = {
      defaultModel: options.defaultModel,
      maxSteps: options.maxSteps,
      searchIgnoreDirs: options.searchIgnoreDirs,
      systemContext: options.systemContext,
      apiKey: options.apiKey,
      preferApiKey: options.preferApiKey,
    };
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
      const state = await this.client.controlPlane.state.query(input.workspaceId ? { workspaceId: input.workspaceId } : undefined);
      const workspaceId = input.workspaceId ?? state.activeWorkspaceId;
      if (!workspaceId) {
        throw new Error('No active Heddle workspace is available from the control-plane API.');
      }

      this.setSnapshot({ workspaceId });
      this.subscribeToSessionList(workspaceId);
      const sessions = await this.refreshSessions();
      const sessionId = input.sessionId ?? sessions[0]?.id ?? (await this.createSession()).id;
      await this.selectSession(sessionId);
    } catch (error) {
      this.setSnapshot({ error: formatError(error), loading: false });
    }
  }

  dispose(): void {
    this.sessionsSubscription?.unsubscribe();
    this.sessionSubscription?.unsubscribe();
    if (this.pendingApprovalPoll) {
      clearInterval(this.pendingApprovalPoll);
    }
    this.sessionsSubscription = undefined;
    this.sessionSubscription = undefined;
    this.pendingApprovalPoll = undefined;
    this.subscriptionAddress = undefined;
  }

  async refreshSessions(): Promise<ControlPlaneSessionView[]> {
    const workspaceId = this.requireWorkspaceId();
    const result = await this.client.controlPlane.sessions.query({ workspaceId });
    const sessions = result.workspaceId === workspaceId ? result.sessions : [];
    this.setSnapshot({ sessions });
    return sessions;
  }

  async createSession(input: SessionCreateInput = {}): Promise<ControlPlaneSessionView> {
    const workspaceId = this.requireWorkspaceId();
    const session = await this.client.controlPlane.sessionCreate.mutate({
      ...input,
      workspaceId,
      model: input.model ?? this.options.defaultModel,
    });
    await this.refreshSessions();
    return session;
  }

  async selectSession(sessionId: string): Promise<void> {
    const workspaceId = this.requireWorkspaceId();
    this.setSnapshot({
      activeSessionId: sessionId,
      activeSession: null,
      pendingApproval: null,
      liveStatus: undefined,
      error: undefined,
      loading: true,
      streamConnected: false,
    });

    try {
      const session = await this.client.controlPlane.session.query({ id: sessionId, workspaceId });
      const running = await this.client.controlPlane.sessionRunning.query({ id: sessionId, workspaceId });
      this.setSnapshot({
        activeSession: session,
        running: running.running,
        loading: false,
      });
      await this.refreshPendingApproval(sessionId);
      this.subscribeToSessionEvents(workspaceId, sessionId);
    } catch (error) {
      this.setSnapshot({ error: formatError(error), loading: false });
    }
  }

  async submitPrompt(prompt: string): Promise<void> {
    const trimmed = prompt.trim();
    if (!trimmed || this.snapshotValue.submitting) {
      return;
    }

    const workspaceId = this.requireWorkspaceId();
    const sessionId = this.requireActiveSessionId();
    this.setSnapshot((current) => ({
      submitting: true,
      running: true,
      error: undefined,
      liveStatus: current.streamConnected
        ? 'Heddle is working...'
        : 'Heddle is working... reconnecting live stream if needed.',
      activeSession: ClientSharedSessionMessageController.appendOptimisticUserTurn(current.activeSession, trimmed),
    }));

    try {
      const result = await this.client.controlPlane.sessionSendPrompt.mutate(this.buildPromptInput({
        workspaceId,
        sessionId,
        prompt: trimmed,
      }));
      this.setSnapshot({
        activeSession: result.session,
        running: false,
        submitting: false,
        liveStatus: undefined,
      });
      await this.refreshSessions();
      await this.refreshPendingApproval(sessionId);
    } catch (error) {
      this.setSnapshot({
        error: formatError(error),
        running: false,
        submitting: false,
        liveStatus: undefined,
      });
    }
  }

  async cancelRun(): Promise<void> {
    const workspaceId = this.requireWorkspaceId();
    const sessionId = this.requireActiveSessionId();
    this.setSnapshot({
      cancelling: true,
      error: undefined,
      liveStatus: 'Stop requested. Waiting for the current step to settle...',
    });

    try {
      const result = await this.client.controlPlane.sessionCancel.mutate({ id: sessionId, workspaceId });
      await this.refreshPendingApproval(sessionId);
      const running = await this.client.controlPlane.sessionRunning.query({ id: sessionId, workspaceId });
      this.setSnapshot({
        running: result.cancelled ? running.running : false,
        cancelling: false,
        liveStatus: result.cancelled && running.running ? this.snapshotValue.liveStatus : undefined,
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
    try {
      const result = await this.client.controlPlane.sessionResolveApproval.mutate({
        workspaceId,
        sessionId,
        decision,
      });
      if (!result.resolved) {
        throw new Error('No pending approval found for this session.');
      }
      await this.refreshPendingApproval(sessionId);
    } catch (error) {
      this.setSnapshot({ error: formatError(error) });
    }
  }

  private async refreshSession(sessionId: string, options: { silent?: boolean } = {}): Promise<void> {
    const workspaceId = this.requireWorkspaceId();
    if (!options.silent) {
      this.setSnapshot({ loading: true });
    }

    try {
      const next = await this.client.controlPlane.session.query({ id: sessionId, workspaceId });
      this.setSnapshot((current) => ({
        activeSession: options.silent
          ? ClientSharedSessionMessageController.mergeTransientMessages(current.activeSession, next)
          : next,
        loading: false,
      }));
    } catch (error) {
      this.setSnapshot({ error: formatError(error), loading: false });
    }
  }

  private async refreshPendingApproval(sessionId: string): Promise<void> {
    const workspaceId = this.requireWorkspaceId();
    const pendingApproval = await this.client.controlPlane.sessionPendingApproval.query({ id: sessionId, workspaceId });
    this.setSnapshot({ pendingApproval });
  }

  private subscribeToSessionList(workspaceId: string): void {
    this.sessionsSubscription?.unsubscribe();
    this.sessionsSubscription = this.client.controlPlane.sessionsEvents.subscribe({ workspaceId }, {
      onData: (event: ControlPlaneSessionsEventEnvelope) => {
        if (event.type === 'sessions.updated') {
          void this.refreshSessions().catch((error) => this.setSnapshot({ error: formatError(error) }));
        }
      },
      onError: (error) => {
        this.setSnapshot({ error: error.message });
      },
    });
  }

  private subscribeToSessionEvents(workspaceId: string, sessionId: string): void {
    if (
      this.subscriptionAddress?.workspaceId === workspaceId &&
      this.subscriptionAddress.sessionId === sessionId
    ) {
      return;
    }

    this.sessionSubscription?.unsubscribe();
    this.subscriptionAddress = { workspaceId, sessionId };
    this.sessionSubscription = this.client.controlPlane.sessionEvents.subscribe({ workspaceId, sessionId }, {
      onStarted: () => {
        this.setSnapshot({ streamConnected: true });
      },
      onData: (event: ControlPlaneSessionEventEnvelope) => {
        this.applySessionEvent(workspaceId, event);
      },
      onError: (error) => {
        this.setSnapshot({ streamConnected: false, liveStatus: error.message });
      },
      onComplete: () => {
        this.setSnapshot({ streamConnected: false });
      },
    });
  }

  private applySessionEvent(workspaceId: string, event: ControlPlaneSessionEventEnvelope): void {
    if (!this.isActiveSessionAddress(workspaceId, event.sessionId)) {
      return;
    }

    if (event.type === 'waiting') {
      this.setSnapshot({ liveStatus: 'Waiting for the session event stream...' });
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
      if (activity.type === 'assistant.stream') {
        this.setSnapshot((current) => ({
          activeSession: ClientSharedSessionMessageController.upsertLiveAssistantMessage(
            current.activeSession,
            activity.text,
            activity.done,
          ),
          liveStatus: activity.done ? undefined : 'Receiving assistant response...',
        }));
        return;
      }

      const status = resolveLiveStatus(activity);
      if (activity.type === 'loop.started') {
        this.setSnapshot({ running: true, liveStatus: status });
        return;
      }

      if (activity.type === 'loop.finished') {
        this.setSnapshot({ running: false, liveStatus: undefined });
        void this.refreshSession(event.sessionId, { silent: true });
        void this.refreshSessions();
        return;
      }

      if (activity.type === 'tool.approval_requested' || activity.type === 'tool.approval_resolved') {
        void this.refreshPendingApproval(event.sessionId);
      }

      if (status !== undefined) {
        this.setSnapshot({ liveStatus: status });
      }
    });
  }

  private buildPromptInput(input: Pick<SessionSendPromptInput, 'workspaceId' | 'sessionId' | 'prompt'>): SessionSendPromptInput {
    return {
      ...input,
      maxSteps: this.options.maxSteps,
      searchIgnoreDirs: this.options.searchIgnoreDirs,
      apiKey: this.options.apiKey,
      preferApiKey: this.options.preferApiKey,
      systemContext: this.options.systemContext,
    };
  }

  private isActiveSessionAddress(workspaceId: string, sessionId: string): boolean {
    return this.snapshotValue.workspaceId === workspaceId && this.snapshotValue.activeSessionId === sessionId;
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
    this.syncPendingApprovalPolling();
    this.listeners.forEach((listener) => listener());
  }

  private syncPendingApprovalPolling(): void {
    if (this.snapshotValue.running && this.snapshotValue.workspaceId && this.snapshotValue.activeSessionId) {
      if (this.pendingApprovalPoll) {
        return;
      }

      this.pendingApprovalPoll = setInterval(() => {
        const sessionId = this.snapshotValue.activeSessionId;
        if (!sessionId) {
          return;
        }

        void this.refreshPendingApproval(sessionId).catch((error) => {
          this.setSnapshot({ error: formatError(error) });
        });
      }, 750);
      return;
    }

    if (!this.pendingApprovalPoll) {
      return;
    }

    clearInterval(this.pendingApprovalPoll);
    this.pendingApprovalPoll = undefined;
  }
}

type ControlPlaneSessionActivity = Extract<ControlPlaneSessionEventEnvelope, { type: 'session.event' }>['activities'][number];
type SessionActivityStatusHandlers = {
  [ActivityType in ControlPlaneSessionActivity['type']]?: (
    activity: Extract<ControlPlaneSessionActivity, { type: ActivityType }>,
  ) => string | undefined;
};

const liveStatusHandlers: SessionActivityStatusHandlers = {
  'loop.started': () => 'Run started...',
  'tool.calling': (activity) => `Working... running ${formatToolLabel(activity)}${formatStep(activity.step)}`,
  'tool.completed': (activity) => `${activity.tool} finished in ${Math.round(activity.durationMs)}ms`,
  'tool.approval_requested': (activity) => `Approval requested for ${formatToolLabel(activity)}`,
  'tool.approval_resolved': () => 'Approval resolved. Resuming...',
  'compaction.running': (activity) => (
    activity.archivePath ? `Compacting earlier history... ${activity.archivePath}` : 'Compacting earlier history...'
  ),
  'compaction.failed': (activity) => (
    activity.error ? `Compaction failed: ${activity.error}` : 'Compaction failed.'
  ),
  'compaction.finished': (activity) => (
    activity.summaryPath ? `Compaction finished. Summary: ${activity.summaryPath}` : 'Compaction finished.'
  ),
};

function resolveLiveStatus(activity: ControlPlaneSessionActivity): string | undefined {
  const handler = liveStatusHandlers[activity.type] as ((activity: ControlPlaneSessionActivity) => string | undefined) | undefined;
  return handler?.(activity);
}

function formatToolLabel(activity: ControlPlaneSessionActivity): string {
  if ('derived' in activity && activity.derived?.kind === 'tool-summary') {
    return activity.derived.summary;
  }

  if ('tool' in activity && typeof activity.tool === 'string') {
    return activity.tool;
  }

  if ('call' in activity && activity.call && 'tool' in activity.call && typeof activity.call.tool === 'string') {
    return activity.call.tool;
  }

  return 'tool';
}

function formatStep(step: number | undefined): string {
  return typeof step === 'number' ? ` (step ${step})` : '';
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
