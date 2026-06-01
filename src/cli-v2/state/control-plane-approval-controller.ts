import type {
  ControlPlaneApprovalDecision,
} from '@/client-shared/api/types.js';
import type { ControlPlaneSessionApiService } from '../services/sessions/control-plane-session-api-service.js';
import type { ControlPlaneSessionState } from './control-plane-session-state.js';

type ControlPlaneApprovalControllerOptions = {
  api: ControlPlaneSessionApiService;
  state: ControlPlaneSessionState;
  formatError: (error: unknown) => string;
};

/**
 * Owns cli-v2 pending-approval state and resolution workflow.
 *
 * Core/control-plane owns approval policy and persistence. This controller only
 * mirrors the pending approval into the TUI snapshot and records the local
 * resolving state around a user's decision.
 */
export class ControlPlaneApprovalController {
  constructor(private readonly options: ControlPlaneApprovalControllerOptions) {}

  async refresh(sessionId: string): Promise<void> {
    const workspaceId = this.options.state.requireWorkspaceId();
    const pendingApproval = await this.options.api.getPendingApproval(workspaceId, sessionId);
    this.options.state.patch({ pendingApproval });
  }

  async resolve(decision: ControlPlaneApprovalDecision): Promise<void> {
    const workspaceId = this.options.state.requireWorkspaceId();
    const sessionId = this.options.state.requireActiveSessionId();
    this.options.state.patch({
      approvalResolving: true,
      error: undefined,
      latestUpdate: {
        label: 'Resolving approval',
        tone: 'info',
      },
    });

    try {
      const result = await this.options.api.resolvePendingApproval(workspaceId, sessionId, decision);
      if (!result.resolved) {
        throw new Error('No pending approval found for this session.');
      }
      await this.refresh(sessionId);
      this.options.state.patch({
        approvalResolving: false,
        latestUpdate: {
          label: 'Approval resolved',
          detail: decision.type,
          tone: 'info',
        },
      });
    } catch (error) {
      this.options.state.patch({
        approvalResolving: false,
        error: this.options.formatError(error),
      });
    }
  }
}
