import type {
  ControlPlanePendingApproval,
  ControlPlaneSessionEventEnvelope,
} from '../../api/types.js';

export type ClientSharedSessionActivity = Extract<ControlPlaneSessionEventEnvelope, { type: 'session.event' }>['activities'][number];

type SessionActivityStatusHandlers = {
  [ActivityType in ClientSharedSessionActivity['type']]?: (
    activity: Extract<ClientSharedSessionActivity, { type: ActivityType }>,
  ) => string | undefined;
};
type ActivityOf<ActivityType extends ClientSharedSessionActivity['type']> = Extract<ClientSharedSessionActivity, { type: ActivityType }>;
type PendingApprovalActivity = ActivityOf<'tool.approval_requested'> | ActivityOf<'tool.approval_resolved'>;
type WorkspaceChangedActivity = ActivityOf<'loop.finished'> | ActivityOf<'tool.completed'>;
type SessionActivityEffectHandlers = {
  [ActivityType in ClientSharedSessionActivity['type']]?: (
    activity: Extract<ClientSharedSessionActivity, { type: ActivityType }>,
    effects: ClientSharedSessionActivityEffects,
  ) => void;
};

export type ClientSharedSessionActivityEffects = {
  onAssistantStream?: (activity: ActivityOf<'assistant.stream'>, liveStatus: string | undefined) => void;
  onRunStarted?: (activity: ActivityOf<'loop.started'>, liveStatus: string | undefined) => void;
  onRunFinished?: (activity: ActivityOf<'loop.finished'>) => void;
  onLiveStatus?: (activity: ClientSharedSessionActivity, liveStatus: string | undefined) => void;
  onPendingApprovalChanged?: (activity: PendingApprovalActivity) => void;
  onWorkspaceChanged?: (activity: WorkspaceChangedActivity) => void;
};

/**
 * Applies control-plane session activity effects shared by frontend clients.
 */
export class ClientSharedSessionActivityService {
  private static readonly effectHandlers: SessionActivityEffectHandlers = {
    'assistant.stream': (activity, effects) => {
      effects.onAssistantStream?.(activity, activity.done ? undefined : 'Receiving assistant response...');
    },
    'loop.started': (activity, effects) => {
      effects.onRunStarted?.(activity, ClientSharedSessionActivityService.formatLiveStatus(activity));
    },
    'loop.finished': (activity, effects) => {
      effects.onRunFinished?.(activity);
      effects.onWorkspaceChanged?.(activity);
    },
    'tool.calling': (activity, effects) => {
      ClientSharedSessionActivityService.applyLiveStatus(activity, effects);
    },
    'tool.completed': (activity, effects) => {
      ClientSharedSessionActivityService.applyLiveStatus(activity, effects);
      effects.onWorkspaceChanged?.(activity);
    },
    'tool.approval_requested': (activity, effects) => {
      effects.onPendingApprovalChanged?.(activity);
      ClientSharedSessionActivityService.applyLiveStatus(activity, effects);
    },
    'tool.approval_resolved': (activity, effects) => {
      effects.onPendingApprovalChanged?.(activity);
      ClientSharedSessionActivityService.applyLiveStatus(activity, effects);
    },
    'compaction.running': (activity, effects) => {
      ClientSharedSessionActivityService.applyLiveStatus(activity, effects);
    },
    'compaction.failed': (activity, effects) => {
      ClientSharedSessionActivityService.applyLiveStatus(activity, effects);
    },
    'compaction.finished': (activity, effects) => {
      ClientSharedSessionActivityService.applyLiveStatus(activity, effects);
    },
  };

  private static readonly liveStatusHandlers: SessionActivityStatusHandlers = {
    'loop.started': () => 'Run started...',
    'tool.calling': (activity) => `Working... running ${ClientSharedSessionActivityService.formatToolLabel(activity)}${ClientSharedSessionActivityService.formatStep(activity.step)}`,
    'tool.completed': (activity) => `${activity.tool} finished in ${Math.round(activity.durationMs)}ms`,
    'tool.approval_requested': (activity) => `Approval requested for ${ClientSharedSessionActivityService.formatToolLabel(activity)}`,
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

  static applyActivity(activity: ClientSharedSessionActivity, effects: ClientSharedSessionActivityEffects): void {
    const handler = ClientSharedSessionActivityService.effectHandlers[activity.type] as (
      (activity: ClientSharedSessionActivity, effects: ClientSharedSessionActivityEffects) => void
    ) | undefined;
    handler?.(activity, effects);
  }

  private static formatLiveStatus(activity: ClientSharedSessionActivity): string | undefined {
    const handler = ClientSharedSessionActivityService.liveStatusHandlers[activity.type] as (
      (activity: ClientSharedSessionActivity) => string | undefined
    ) | undefined;
    return handler?.(activity);
  }

  static formatPendingApprovalLabel(approval: NonNullable<ControlPlanePendingApproval>): string | undefined {
    return approval.tool;
  }

  static formatToolLabel(activity: ClientSharedSessionActivity): string {
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

  static formatToolFallbackLabel(activity: Extract<ClientSharedSessionActivity, { type: 'tool.fallback' }>): string | undefined {
    if (activity.derived?.kind === 'tool-fallback-summary') {
      return `${activity.derived.fromSummary} -> ${activity.derived.toSummary}`;
    }

    return `${activity.fromCall.tool} -> ${activity.toCall.tool}`;
  }

  static formatStepDetail(step: number | undefined): string | undefined {
    return typeof step === 'number' ? `step ${step}` : undefined;
  }

  private static formatStep(step: number | undefined): string {
    return typeof step === 'number' ? ` (step ${step})` : '';
  }

  private static applyLiveStatus(activity: ClientSharedSessionActivity, effects: ClientSharedSessionActivityEffects): void {
    effects.onLiveStatus?.(activity, ClientSharedSessionActivityService.formatLiveStatus(activity));
  }
}
