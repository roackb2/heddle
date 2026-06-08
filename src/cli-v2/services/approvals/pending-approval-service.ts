import type {
  ControlPlaneApprovalDecision,
  ControlPlanePendingApproval,
} from '@/client-shared/api/types.js';
import { ClientSharedApprovalDisplayService } from '@/client-shared/services/approvals/index.js';

export type PendingApproval = NonNullable<ControlPlanePendingApproval>;

export type ApprovalChoice = 'approve' | 'trust_repo' | 'allow_project' | 'deny';

/**
 * Owns cli-v2 approval choices, labels, and terminal display formatting.
 */
export class PendingApprovalService {
  static resolveAvailableChoices(approval: PendingApproval): ApprovalChoice[] {
    return [
      'approve',
      ...(approval.autopilotRootApproval ? ['trust_repo' as const] : []),
      ...(approval.rememberProjectApproval ? ['allow_project' as const] : []),
      'deny',
    ];
  }

  static resolveDecision(
    choice: ApprovalChoice,
    approval: PendingApproval,
  ): ControlPlaneApprovalDecision {
    if (choice === 'deny') {
      return { type: 'deny', reason: 'Denied in cli-v2' };
    }

    if (choice === 'allow_project' && approval.rememberProjectApproval) {
      return {
        type: 'approve_and_remember_project',
        reason: 'Approved and remembered for this project in cli-v2',
      };
    }

    if (choice === 'trust_repo' && approval.autopilotRootApproval) {
      return {
        type: 'approve_and_trust_autopilot_root',
        reason: `Approved and trusted ${approval.autopilotRootApproval.relativeRoot} for Auto in cli-v2`,
      };
    }

    return { type: 'approve', reason: 'Approved in cli-v2' };
  }

  static resolveInputDetail(input: unknown): { label: string; value: string } | undefined {
    return ClientSharedApprovalDisplayService.resolveInputDetail(input);
  }

  static formatPayload(input: unknown, maxChars = 1200): string | undefined {
    return ClientSharedApprovalDisplayService.formatPayload(input, maxChars);
  }
}
