import type {
  ControlPlanePendingApproval,
  ControlPlaneSessionEventEnvelope,
} from '../../api/types.js';
import dayjs from 'dayjs';
import duration from 'dayjs/plugin/duration.js';

dayjs.extend(duration);

export type ClientSharedSessionActivity = Extract<ControlPlaneSessionEventEnvelope, { type: 'session.event' }>['activities'][number];
export type ClientSharedAgentActivityStatus = {
  label: string;
  detail?: string;
  startedAt: string;
  tone: 'info' | 'warning';
};
export type ClientSharedSessionLatestUpdate = {
  label: string;
  detail?: string;
  tone: 'info' | 'success' | 'warning' | 'error';
};

type SessionActivityStatusHandlers = {
  [ActivityType in ClientSharedSessionActivity['type']]?: (
    activity: Extract<ClientSharedSessionActivity, { type: ActivityType }>,
  ) => string | undefined;
};
type SessionActivityLatestUpdateHandlers = {
  [ActivityType in ClientSharedSessionActivity['type']]?: (
    activity: Extract<ClientSharedSessionActivity, { type: ActivityType }>,
  ) => ClientSharedSessionLatestUpdate | undefined;
};
type ActivityOf<ActivityType extends ClientSharedSessionActivity['type']> = Extract<ClientSharedSessionActivity, { type: ActivityType }>;
type PendingApprovalActivity = ActivityOf<'tool.approval_requested'> | ActivityOf<'tool.approval_resolved'>;
type WorkspaceChangedActivity = ActivityOf<'loop.finished'> | ActivityOf<'tool.completed'>;
export type ClientSharedSessionPlan = ActivityOf<'plan.updated'>;
type SessionActivityEffectHandlers = {
  [ActivityType in ClientSharedSessionActivity['type']]?: (
    activity: Extract<ClientSharedSessionActivity, { type: ActivityType }>,
    effects: ClientSharedSessionActivityEffects,
  ) => void;
};

export type ClientSharedSessionActivityEffects = {
  onAssistantStream?: (activity: ActivityOf<'assistant.stream'>, liveStatus: string | undefined) => void;
  onRunStarted?: (activity: ActivityOf<'loop.started'>, liveStatus: string | undefined) => void;
  onRunFinished?: (activity: ActivityOf<'loop.finished'>, liveStatus: string | undefined) => void;
  onPlanUpdated?: (activity: ClientSharedSessionPlan) => void;
  onPlanCleared?: () => void;
  onLiveStatus?: (activity: ClientSharedSessionActivity, liveStatus: string | undefined) => void;
  onCurrentActivityChanged?: (activity: ClientSharedAgentActivityStatus | undefined) => void;
  onPendingApprovalChanged?: (activity: PendingApprovalActivity) => void;
  onWorkspaceChanged?: (activity: WorkspaceChangedActivity) => void;
};

/**
 * Owns client-side effects derived from API-provided session activities.
 *
 * Core/live owns the activity vocabulary and facts. This service owns only the
 * frontend-neutral consequences shared by web-v2 and cli-v2, including active
 * plan lifetime: a plan is visible after `plan.updated` and cleared when a new
 * run starts or the current run finishes.
 */
export class ClientSharedSessionActivityService {
  // Dispatches raw control-plane activity facts into frontend-neutral effects.
  // Keep lifecycle policy here when both web-v2 and cli-v2 must react the same
  // way, such as active plan lifetime, pending approval refresh, and current
  // activity state. Do not put host-specific rendering, colors, layout, or
  // keyboard behavior in this map.
  private static readonly effectHandlers: SessionActivityEffectHandlers = {
    'assistant.stream': (activity, effects) => {
      effects.onAssistantStream?.(activity, activity.done ? undefined : 'Receiving assistant response...');
      effects.onCurrentActivityChanged?.(undefined);
    },
    'loop.started': (activity, effects) => {
      effects.onPlanCleared?.();
      effects.onCurrentActivityChanged?.(ClientSharedSessionActivityService.createThinkingStatus(activity.timestamp));
      effects.onRunStarted?.(activity, ClientSharedSessionActivityService.formatLiveStatus(activity));
    },
    'loop.finished': (activity, effects) => {
      effects.onPlanCleared?.();
      effects.onCurrentActivityChanged?.(undefined);
      effects.onRunFinished?.(activity, ClientSharedSessionActivityService.formatLiveStatus(activity));
      effects.onWorkspaceChanged?.(activity);
    },
    'tool.calling': (activity, effects) => {
      effects.onCurrentActivityChanged?.({
        label: `Running ${ClientSharedSessionActivityService.formatToolName(activity)}`,
        detail: ClientSharedSessionActivityService.formatStepDetail(activity.step),
        startedAt: activity.timestamp,
        tone: activity.requiresApproval ? 'warning' : 'info',
      });
      ClientSharedSessionActivityService.applyLiveStatus(activity, effects);
    },
    'tool.completed': (activity, effects) => {
      effects.onCurrentActivityChanged?.(ClientSharedSessionActivityService.createThinkingStatus(activity.timestamp));
      ClientSharedSessionActivityService.applyLiveStatus(activity, effects);
      effects.onWorkspaceChanged?.(activity);
    },
    'plan.updated': (activity, effects) => {
      effects.onPlanUpdated?.(activity);
    },
    'tool.approval_requested': (activity, effects) => {
      effects.onPendingApprovalChanged?.(activity);
      effects.onCurrentActivityChanged?.({
        label: 'Waiting for approval',
        startedAt: activity.timestamp,
        tone: 'warning',
      });
      ClientSharedSessionActivityService.applyLiveStatus(activity, effects);
    },
    'tool.approval_resolved': (activity, effects) => {
      effects.onPendingApprovalChanged?.(activity);
      effects.onCurrentActivityChanged?.(ClientSharedSessionActivityService.createThinkingStatus(activity.timestamp));
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

  // Formats legacy/live status strings from activity facts. These strings are
  // compatibility status text for existing host state, not the canonical
  // current/latest activity UI. Prefer extending current/latest projections
  // below for new user-visible run status surfaces.
  private static readonly liveStatusHandlers: SessionActivityStatusHandlers = {
    'loop.started': () => 'Run started...',
    'loop.finished': (activity) => `Run finished: ${activity.outcome}`,
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

  // Projects activity facts into the stable "latest activity" breadcrumb shown
  // near prompts/composers. This is intentionally allowed to include useful
  // review detail such as command/path summaries because it describes what just
  // happened. Do not use this for active timers or "what is running now" UI.
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
      tone: ClientSharedSessionActivityService.resolveRunOutcomeTone(activity.outcome),
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

  static applyActivity(activity: ClientSharedSessionActivity, effects: ClientSharedSessionActivityEffects): void {
    const handler = ClientSharedSessionActivityService.effectHandlers[activity.type] as (
      (activity: ClientSharedSessionActivity, effects: ClientSharedSessionActivityEffects) => void
    ) | undefined;
    handler?.(activity, effects);
  }

  static resolveLatestUpdate(activity: ClientSharedSessionActivity): ClientSharedSessionLatestUpdate | undefined {
    const handler = ClientSharedSessionActivityService.latestUpdateHandlers[activity.type] as (
      (activity: ClientSharedSessionActivity) => ClientSharedSessionLatestUpdate | undefined
    ) | undefined;
    return handler?.(activity);
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

  // Rich label for review/history surfaces. This may include derived summaries
  // such as command strings or file paths, so it belongs in latest activity,
  // approval panels, and transcripts rather than the active "doing now" line.
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

  // Coarse tool name for current activity. Keep this payload-free so active
  // status does not duplicate details already visible in approval cards or
  // transcript/tool-result surfaces.
  static formatToolName(activity: ClientSharedSessionActivity): string {
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

  static createThinkingStatus(startedAt: string = new Date().toISOString()): ClientSharedAgentActivityStatus {
    return {
      label: 'Thinking',
      startedAt,
      tone: 'info',
    };
  }

  // Shared elapsed formatter for web and TUI current-activity timers. Use dayjs
  // here so hosts do not hand-roll duration math or drift in formatting.
  static formatElapsed(startedAt: string, now: Date = new Date()): string {
    const started = dayjs(startedAt);
    if (!started.isValid()) {
      return '0s';
    }

    const elapsed = dayjs.duration(Math.max(0, dayjs(now).diff(started, 'second')), 'seconds');
    const seconds = Math.floor(elapsed.asSeconds());
    if (seconds < 60) {
      return `${seconds}s`;
    }

    const minutes = Math.floor(elapsed.asMinutes());
    const remainingSeconds = seconds - (minutes * 60);
    return `${minutes}m ${remainingSeconds}s`;
  }

  static resolveRunOutcomeTone(outcome: string): ClientSharedSessionLatestUpdate['tone'] {
    if (outcome === 'done' || outcome === 'completed') {
      return 'success';
    }

    return outcome === 'error' ? 'error' : 'warning';
  }

  private static formatStep(step: number | undefined): string {
    return typeof step === 'number' ? ` (step ${step})` : '';
  }

  private static applyLiveStatus(activity: ClientSharedSessionActivity, effects: ClientSharedSessionActivityEffects): void {
    effects.onLiveStatus?.(activity, ClientSharedSessionActivityService.formatLiveStatus(activity));
  }
}
