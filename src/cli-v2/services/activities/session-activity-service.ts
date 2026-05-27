import type {
  ControlPlanePendingApproval,
  ControlPlaneSessionEventEnvelope,
} from '@/client-shared/api/types.js';
import { ClientSharedSessionActivityService } from '@/client-shared/services/session-activities/index.js';

type ControlPlaneSessionActivity = Extract<ControlPlaneSessionEventEnvelope, { type: 'session.event' }>['activities'][number];
export type ControlPlaneSessionLatestUpdate = {
  label: string;
  detail?: string;
  tone: 'info' | 'success' | 'warning' | 'error';
};
type SessionActivityLatestUpdateHandlers = {
  [ActivityType in ControlPlaneSessionActivity['type']]?: (
    activity: Extract<ControlPlaneSessionActivity, { type: ActivityType }>,
  ) => ControlPlaneSessionLatestUpdate | undefined;
};

/**
 * Projects control-plane session activities into terminal status text.
 */
export class SessionActivityService {
  private static readonly latestUpdateHandlers: SessionActivityLatestUpdateHandlers = {
    'loop.started': (activity) => ({
      label: 'Run started',
      detail: `${activity.model} via ${activity.provider}`,
      tone: 'info',
    }),
    'tool.calling': (activity) => ({
      label: `Running ${ClientSharedSessionActivityService.formatToolLabel(activity)}`,
      detail: ClientSharedSessionActivityService.formatStepDetail(activity.step),
      tone: activity.requiresApproval ? 'warning' : 'info',
    }),
    'tool.completed': (activity) => ({
      label: `${activity.tool} completed`,
      detail: `${Math.round(activity.durationMs)}ms`,
      tone: 'success',
    }),
    'tool.approval_requested': (activity) => ({
      label: 'Approval requested',
      detail: ClientSharedSessionActivityService.formatToolLabel(activity),
      tone: 'warning',
    }),
    'tool.approval_resolved': (activity) => ({
      label: activity.approved ? 'Approval granted' : 'Approval denied',
      detail: activity.reason,
      tone: activity.approved ? 'info' : 'warning',
    }),
    'tool.fallback': (activity) => ({
      label: 'Tool fallback',
      detail: ClientSharedSessionActivityService.formatToolFallbackLabel(activity),
      tone: 'warning',
    }),
    'loop.finished': (activity) => ({
      label: 'Run finished',
      detail: activity.outcome,
      tone: SessionActivityService.resolveRunOutcomeTone(activity.outcome),
    }),
    'compaction.running': (activity) => ({
      label: 'Compacting history',
      detail: activity.archivePath,
      tone: 'info',
    }),
    'compaction.failed': (activity) => ({
      label: 'Compaction failed',
      detail: activity.error,
      tone: 'error',
    }),
    'compaction.finished': (activity) => ({
      label: 'Compaction finished',
      detail: activity.summaryPath,
      tone: 'success',
    }),
  };

  static resolveLatestUpdate(activity: ControlPlaneSessionActivity): ControlPlaneSessionLatestUpdate | undefined {
    const handler = SessionActivityService.latestUpdateHandlers[activity.type] as (
      (activity: ControlPlaneSessionActivity) => ControlPlaneSessionLatestUpdate | undefined
    ) | undefined;
    return handler?.(activity);
  }

  static formatPendingApprovalLabel(approval: NonNullable<ControlPlanePendingApproval>): string | undefined {
    return ClientSharedSessionActivityService.formatPendingApprovalLabel(approval);
  }

  static resolveRunOutcomeTone(outcome: string): ControlPlaneSessionLatestUpdate['tone'] {
    if (outcome === 'done' || outcome === 'completed') {
      return 'success';
    }

    return outcome === 'error' ? 'error' : 'warning';
  }
}
