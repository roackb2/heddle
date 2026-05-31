import type {
  ControlPlanePendingApproval,
  ControlPlaneSessionEventEnvelope,
} from '@/client-shared/api/types.js';
import {
  ClientSharedSessionActivityService,
  type ClientSharedSessionLatestUpdate,
} from '@/client-shared/services/session-activities/index.js';

type ControlPlaneSessionActivity = Extract<ControlPlaneSessionEventEnvelope, { type: 'session.event' }>['activities'][number];
export type ControlPlaneSessionLatestUpdate = ClientSharedSessionLatestUpdate;

/**
 * Projects control-plane session activities into terminal status text.
 */
export class SessionActivityService {
  static resolveLatestUpdate(activity: ControlPlaneSessionActivity): ControlPlaneSessionLatestUpdate | undefined {
    return ClientSharedSessionActivityService.resolveLatestUpdate(activity);
  }

  static formatPendingApprovalLabel(approval: NonNullable<ControlPlanePendingApproval>): string | undefined {
    return ClientSharedSessionActivityService.formatPendingApprovalLabel(approval);
  }

  static resolveRunOutcomeTone(outcome: string): ControlPlaneSessionLatestUpdate['tone'] {
    return ClientSharedSessionActivityService.resolveRunOutcomeTone(outcome);
  }
}
