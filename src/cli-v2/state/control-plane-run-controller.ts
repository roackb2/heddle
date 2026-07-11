import type {
  ControlPlaneSessionEventEnvelope,
  ControlPlaneSessionRunEventEnvelope,
  ControlPlaneSessionRunReference,
} from '@/client-shared/api/types.js';
import { ClientSharedNotificationIntentService } from '@/client-shared/services/notifications/index.js';
import { SessionActivityService } from '../services/activities/session-activity-service.js';
import type { ControlPlaneTerminalNotificationService } from '../services/notifications/index.js';
import type { SessionRunStatePollAddress } from '../services/sessions/session-run-state-poller-service.js';
import type { ControlPlaneSessionApiService } from '../services/sessions/control-plane-session-api-service.js';
import type { ControlPlaneSessionSubscriptionService } from '../services/sessions/control-plane-session-subscription-service.js';
import type { ControlPlaneSessionLoader } from './control-plane-session-loader.js';
import type { ControlPlaneApprovalController } from './control-plane-approval-controller.js';
import type { ControlPlaneSessionState } from './control-plane-session-state.js';

type ControlPlaneRunControllerOptions = {
  api: ControlPlaneSessionApiService;
  state: ControlPlaneSessionState;
  loader: ControlPlaneSessionLoader;
  subscriptions: ControlPlaneSessionSubscriptionService;
  approvals: ControlPlaneApprovalController;
  refreshSessions: () => Promise<unknown>;
  formatError: (error: unknown) => string;
  notificationService?: ControlPlaneTerminalNotificationService;
};

type TrackedControlPlaneRun = ControlPlaneSessionRunReference & {
  workspaceId: string;
  sessionId: string;
};

/**
 * Owns cli-v2's mirror of the server-held run identity and terminal state.
 *
 * Ordered activity and replay stay in ConversationRunService. This controller
 * attaches the TUI to accepted run IDs, targets cancellation at the observed
 * run, and uses sessionRunState only for refresh/recovery fallback.
 */
export class ControlPlaneRunController {
  private runObservationVersion = 0;

  constructor(private readonly options: ControlPlaneRunControllerOptions) {}

  trackAcceptedRun(run: TrackedControlPlaneRun): void {
    if (!this.options.state.isActiveSessionAddress(run.workspaceId, run.sessionId)) {
      return;
    }

    const currentRunId = this.options.state.getSnapshot().activeRun?.runId;
    if (currentRunId !== run.runId) {
      this.runObservationVersion += 1;
    }
    this.options.state.patch({
      activeRun: {
        runId: run.runId,
        acceptedAt: run.acceptedAt,
      },
      running: true,
      cancelling: false,
      error: undefined,
    });
    this.options.subscriptions.subscribeToRun(run);
  }

  observeSessionEvent(workspaceId: string, event: ControlPlaneSessionEventEnvelope): void {
    if (
      event.type !== 'session.run.updated'
      || !this.options.state.isActiveSessionAddress(workspaceId, event.sessionId)
    ) {
      return;
    }

    const run = {
      workspaceId,
      sessionId: event.sessionId,
      ...event.run,
    };
    if (event.status === 'started') {
      this.trackAcceptedRun(run);
      return;
    }

    // The terminal run item is the source of truth. A settled lifecycle signal
    // ensures a client that missed the start signal still attaches to replay.
    this.options.subscriptions.subscribeToRun(run);
  }

  applyRunEvent(
    workspaceId: string,
    sessionId: string,
    event: ControlPlaneSessionRunEventEnvelope,
  ): void {
    if (
      event.kind === 'activity'
      || !this.options.state.isActiveSessionAddress(workspaceId, sessionId)
    ) {
      return;
    }

    const activeRun = this.options.state.getSnapshot().activeRun;
    if (activeRun && activeRun.runId !== event.runId) {
      return;
    }

    const terminal = terminalPresentation(event);
    this.runObservationVersion += 1;
    this.options.notificationService?.deliver(
      ClientSharedNotificationIntentService.projectSessionRunTerminal({
        workspaceId,
        envelope: {
          type: 'session.run.terminal',
          sessionId,
          timestamp: event.timestamp,
          terminal: event,
        },
      }),
    );
    this.options.state.patch({
      activeRun: undefined,
      running: false,
      cancelling: false,
      streamConnected: false,
      liveStatus: terminal.liveStatus,
      currentActivity: undefined,
      activePlan: undefined,
      latestUpdate: terminal.latestUpdate,
      ...(event.kind === 'error' ? { error: event.error.message } : {}),
    });
    void Promise.all([
      this.options.loader.refreshSession(sessionId, { silent: true }),
      this.options.refreshSessions(),
      this.options.approvals.refresh(sessionId),
    ]).catch((error) => {
      this.options.state.patch({ error: this.options.formatError(error) });
    });
  }

  async cancelRun(): Promise<void> {
    const workspaceId = this.options.state.requireWorkspaceId();
    const sessionId = this.options.state.requireActiveSessionId();
    const runId = this.options.state.getSnapshot().activeRun?.runId;
    this.options.state.patch({
      cancelling: true,
      error: undefined,
      liveStatus: 'Stop requested. Waiting for the current step to settle...',
      latestUpdate: {
        label: 'Stop requested',
        tone: 'warning',
      },
    });

    try {
      const result = await this.options.api.cancelRun(workspaceId, sessionId, runId);
      await this.options.approvals.refresh(sessionId);
      const runState = await this.options.api.getRunState(workspaceId, sessionId);
      this.options.state.patch({
        activeRun: runState.activeRun ?? undefined,
        running: runState.running,
        cancelling: false,
        liveStatus: result.cancelled && runState.running ? this.options.state.getSnapshot().liveStatus : undefined,
        currentActivity: result.cancelled && runState.running ? this.options.state.getSnapshot().currentActivity : undefined,
        latestUpdate: {
          label: result.cancelled ? 'Stop request accepted' : 'No matching active run to stop',
          tone: result.cancelled ? 'warning' : 'info',
        },
      });
    } catch (error) {
      this.options.state.patch({
        error: this.options.formatError(error),
        cancelling: false,
        liveStatus: undefined,
        currentActivity: undefined,
      });
    }
  }

  shouldPollRunState(): boolean {
    const snapshot = this.options.state.getSnapshot();
    return snapshot.running || snapshot.submitting || snapshot.cancelling;
  }

  resolveRunStatePollAddress(): SessionRunStatePollAddress | undefined {
    const { workspaceId, activeSessionId } = this.options.state.getSnapshot();
    return workspaceId && activeSessionId ? { workspaceId, sessionId: activeSessionId } : undefined;
  }

  async pollRunState({ workspaceId, sessionId }: SessionRunStatePollAddress): Promise<void> {
    const observationVersion = this.runObservationVersion;
    const runState = await this.options.api.getRunState(workspaceId, sessionId);
    if (
      !this.options.state.isActiveSessionAddress(workspaceId, sessionId)
      || observationVersion !== this.runObservationVersion
    ) {
      return;
    }

    const snapshot = this.options.state.getSnapshot();
    const wasActive = snapshot.running || snapshot.submitting || snapshot.cancelling;
    if (runState.activeRun) {
      this.trackAcceptedRun({ workspaceId, sessionId, ...runState.activeRun });
    }
    this.options.state.patch({
      activeRun: runState.activeRun ?? snapshot.activeRun,
      pendingApproval: runState.pendingApproval,
      running: runState.running || Boolean(snapshot.activeRun),
      runtimeContext: snapshot.runtimeContext
        ? { ...snapshot.runtimeContext, running: runState.running }
        : snapshot.runtimeContext,
      cancelling: runState.running ? snapshot.cancelling : false,
      latestUpdate: runState.pendingApproval
        ? {
          label: 'Approval requested',
          detail: SessionActivityService.formatPendingApprovalLabel(runState.pendingApproval),
          tone: 'warning',
        }
        : snapshot.latestUpdate,
    });

    if (runState.running) {
      return;
    }

    if (wasActive && !this.options.state.getSnapshot().submitting) {
      this.options.notificationService?.deliver({
        key: [
          'session-run-terminal',
          workspaceId,
          sessionId,
          snapshot.activeRun?.runId ?? 'poll-fallback',
        ].join(':'),
        title: 'Session run finished',
        tone: 'success',
        timestamp: new Date().toISOString(),
        workspaceId,
        sessionId,
      });
    }

    if (this.options.state.getSnapshot().submitting) {
      this.options.state.patch({
        liveStatus: 'Waiting for run acceptance...',
        latestUpdate: {
          label: 'Run starting',
          detail: 'waiting for server acceptance',
          tone: 'info',
        },
      });
      return;
    }

    await this.options.loader.refreshSession(sessionId, { silent: true });
    await this.options.refreshSessions();
    this.options.state.patch({
      activeRun: undefined,
      running: false,
      submitting: false,
      liveStatus: undefined,
      activePlan: undefined,
      currentActivity: undefined,
      latestUpdate: {
        label: 'Run finished',
        tone: 'success',
      },
    });
  }
}

function terminalPresentation(event: Exclude<ControlPlaneSessionRunEventEnvelope, { kind: 'activity' }>) {
  if (event.kind === 'error') {
    return {
      liveStatus: event.error.message,
      latestUpdate: { label: 'Run failed', detail: event.error.message, tone: 'error' as const },
    };
  }
  if (event.kind === 'cancelled') {
    return {
      liveStatus: 'Run cancelled.',
      latestUpdate: { label: 'Run cancelled', detail: event.reason, tone: 'warning' as const },
    };
  }
  return {
    liveStatus: undefined,
    latestUpdate: {
      label: 'Run finished',
      detail: event.result.outcome ?? event.result.summary,
      tone: event.result.outcome
        ? SessionActivityService.resolveRunOutcomeTone(event.result.outcome)
        : 'success' as const,
    },
  };
}
