import { SessionActivityService } from '../services/activities/session-activity-service.js';
import type { SessionRunStatePollAddress } from '../services/sessions/session-run-state-poller-service.js';
import type { ControlPlaneSessionApiService } from '../services/sessions/control-plane-session-api-service.js';
import type { ControlPlaneSessionLoader } from './control-plane-session-loader.js';
import type { ControlPlaneApprovalController } from './control-plane-approval-controller.js';
import type { ControlPlaneSessionState } from './control-plane-session-state.js';

type ControlPlaneRunControllerOptions = {
  api: ControlPlaneSessionApiService;
  state: ControlPlaneSessionState;
  loader: ControlPlaneSessionLoader;
  approvals: ControlPlaneApprovalController;
  refreshSessions: () => Promise<unknown>;
  formatError: (error: unknown) => string;
};

/**
 * Owns cli-v2 run cancellation and polling fallback.
 *
 * The server remains the source of truth for active runs. This controller owns
 * the TUI mirror: stop-request state, polling-based recovery when events lag,
 * and final refresh once a run is no longer active.
 */
export class ControlPlaneRunController {
  constructor(private readonly options: ControlPlaneRunControllerOptions) {}

  async cancelRun(): Promise<void> {
    const workspaceId = this.options.state.requireWorkspaceId();
    const sessionId = this.options.state.requireActiveSessionId();
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
      const result = await this.options.api.cancelRun(workspaceId, sessionId);
      await this.options.approvals.refresh(sessionId);
      const running = await this.options.api.getRunning(workspaceId, sessionId);
      this.options.state.patch({
        running: result.cancelled ? running.running : false,
        cancelling: false,
        liveStatus: result.cancelled && running.running ? this.options.state.getSnapshot().liveStatus : undefined,
        currentActivity: result.cancelled && running.running ? this.options.state.getSnapshot().currentActivity : undefined,
        latestUpdate: {
          label: result.cancelled ? 'Stop request accepted' : 'No active run to stop',
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
    const runState = await this.options.api.getRunState(workspaceId, sessionId);
    if (!this.options.state.isActiveSessionAddress(workspaceId, sessionId)) {
      return;
    }

    const snapshot = this.options.state.getSnapshot();
    this.options.state.patch({
      pendingApproval: runState.pendingApproval,
      running: runState.running,
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
