import type { ControlPlaneSessionApiService } from '../services/sessions/control-plane-session-api-service.js';
import type { ControlPlaneSessionDirectShellAsyncResult } from '@/client-shared/api/types.js';
import type { AssistantStreamBufferService } from '../services/sessions/assistant-stream-buffer-service.js';
import type { ControlPlaneSessionLoader } from './control-plane-session-loader.js';
import type { ControlPlaneSessionState } from './control-plane-session-state.js';

type ControlPlaneDirectShellControllerOptions = {
  api: ControlPlaneSessionApiService;
  state: ControlPlaneSessionState;
  loader: ControlPlaneSessionLoader;
  assistantStreamBuffer: AssistantStreamBufferService;
  refreshSessions: () => Promise<unknown>;
  refreshPendingApproval: (sessionId: string) => Promise<void>;
  onRunAccepted: (run: Extract<ControlPlaneSessionDirectShellAsyncResult, { accepted: true }>) => void;
  formatError: (error: unknown) => string;
};

/**
 * Owns cli-v2 direct-shell interaction state.
 *
 * Core/control-plane owns shell policy and execution. This controller owns only
 * the TUI workflow around that policy: empty-command rejection, local
 * confirmation state, direct-shell run submission, and terminal activity
 * snapshot transitions.
 */
export class ControlPlaneDirectShellController {
  constructor(private readonly options: ControlPlaneDirectShellControllerOptions) {}

  async submit(command: string): Promise<void> {
    if (!command.trim()) {
      this.options.state.patch({
        error: 'Direct shell command cannot be empty.',
      });
      return;
    }

    if (this.options.state.getSnapshot().running) {
      this.options.state.patch({
        error: undefined,
        latestUpdate: {
          label: 'Direct shell blocked',
          detail: 'wait for the current run to finish',
          tone: 'warning',
        },
      });
      return;
    }

    const workspaceId = this.options.state.requireWorkspaceId();
    const sessionId = this.options.state.requireActiveSessionId();
    const preflight = await this.options.api.preflightDirectShell({ workspaceId, sessionId, command });
    if (preflight.risk === 'blocked') {
      this.options.state.patch({
        error: preflight.reason ?? 'Direct shell command is blocked by shell policy.',
      });
      return;
    }

    if (preflight.risk === 'confirmRequired') {
      this.options.state.patch({
        pendingDirectShellConfirmation: preflight,
        error: undefined,
        latestUpdate: {
          label: 'Confirm shell command',
          detail: preflight.reason,
          tone: 'warning',
        },
      });
      return;
    }

    await this.startRun(command);
  }

  async resolveConfirmation(accepted: boolean): Promise<void> {
    const pending = this.options.state.getSnapshot().pendingDirectShellConfirmation;
    if (!pending) {
      return;
    }

    this.options.state.patch({ pendingDirectShellConfirmation: undefined });
    if (!accepted) {
      this.options.state.patch({
        latestUpdate: {
          label: 'Direct shell cancelled',
          detail: pending.command,
          tone: 'info',
        },
      });
      return;
    }

    await this.startRun(pending.command, true);
  }

  private async startRun(command: string, riskAccepted?: boolean): Promise<void> {
    const workspaceId = this.options.state.requireWorkspaceId();
    const sessionId = this.options.state.requireActiveSessionId();
    this.options.state.patch((current) => ({
      submitting: true,
      running: true,
      error: undefined,
      pendingDirectShellConfirmation: undefined,
      activePlan: undefined,
      currentActivity: {
        label: 'Running shell',
        startedAt: new Date().toISOString(),
        tone: 'info',
      },
      liveStatus: current.streamConnected
        ? 'Running direct shell command...'
        : 'Running direct shell command... reconnecting live stream if needed.',
      latestUpdate: {
        label: 'Direct shell accepted',
        detail: command,
        tone: 'info',
      },
    }));

    try {
      const result = await this.options.api.runDirectShellAsync({ workspaceId, sessionId, command, riskAccepted });
      if ('accepted' in result) {
        this.options.onRunAccepted(result);
      }
      this.options.assistantStreamBuffer.reset();
      this.options.state.patch({
        submitting: false,
        running: 'accepted' in result,
        latestUpdate: {
          label: 'Direct shell accepted',
          detail: 'accepted' in result ? result.runId : undefined,
          tone: 'info',
        },
      });
      await this.options.loader.refreshSession(sessionId, { silent: true });
      await this.options.refreshSessions();
      await this.options.refreshPendingApproval(sessionId);
    } catch (error) {
      this.options.state.patch({
        error: this.options.formatError(error),
        running: false,
        submitting: false,
        liveStatus: undefined,
        currentActivity: undefined,
      });
      await this.options.loader.refreshSession(sessionId, { silent: true }).catch(() => undefined);
      this.options.assistantStreamBuffer.reset();
    }
  }
}
