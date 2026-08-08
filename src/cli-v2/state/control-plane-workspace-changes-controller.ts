import type { ControlPlaneSessionApiService } from '../services/sessions/control-plane-session-api-service.js';
import type { ControlPlaneSessionState } from './control-plane-session-state.js';

type ControlPlaneWorkspaceChangesControllerOptions = {
  api: ControlPlaneSessionApiService;
  state: ControlPlaneSessionState;
  formatError: (error: unknown) => string;
};

/**
 * Refreshes the terminal's workspace-change view from the control-plane Git
 * projection. It coalesces activity bursts and ignores responses for a
 * workspace that is no longer selected before they reach render state.
 */
export class ControlPlaneWorkspaceChangesController {
  private refreshPromise: Promise<void> | undefined;
  private refreshRequested = false;
  private requestedWorkspaceId: string | undefined;

  constructor(private readonly options: ControlPlaneWorkspaceChangesControllerOptions) {}

  refresh(workspaceId = this.options.state.requireWorkspaceId()): Promise<void> {
    this.requestedWorkspaceId = workspaceId;
    this.refreshRequested = true;
    if (!this.refreshPromise) {
      this.refreshPromise = this.drainRefreshes();
    }
    return this.refreshPromise;
  }

  private async drainRefreshes(): Promise<void> {
    try {
      while (this.refreshRequested) {
        this.refreshRequested = false;
        const workspaceId = this.requestedWorkspaceId;
        if (!workspaceId) {
          continue;
        }

        try {
          const changes = await this.options.api.getWorkspaceChanges(workspaceId);
          if (
            changes.workspaceId === workspaceId
            && this.options.state.getSnapshot().workspaceId === workspaceId
          ) {
            this.options.state.patch({ workspaceChanges: changes.files });
          }
        } catch (error) {
          if (this.options.state.getSnapshot().workspaceId === workspaceId) {
            this.options.state.patch({ error: this.options.formatError(error) });
          }
        }
      }
    } finally {
      this.refreshPromise = undefined;
    }
  }
}
