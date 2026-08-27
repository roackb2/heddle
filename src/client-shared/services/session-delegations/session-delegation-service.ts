import dayjs from 'dayjs';
import duration from 'dayjs/plugin/duration.js';
import type {
  ControlPlaneSessionRunEventEnvelope,
  ControlPlaneSessionTurn,
} from '../../api/types.js';
import { ClientSharedSessionActivityService } from '../session-activities/index.js';

dayjs.extend(duration);

type SessionActivity = Extract<ControlPlaneSessionRunEventEnvelope, { kind: 'activity' }>['activity'];
type SettledDelegation = NonNullable<ControlPlaneSessionTurn['delegations']>[number];

export type ClientSharedDelegationActivity = {
  label: string;
  detail?: string;
};

export type ClientSharedDelegationView = {
  delegationId: string;
  rootRunId: string;
  childRunId: string;
  agentProfileId: string;
  agentName: string;
  task: string;
  status: 'running' | 'finished' | 'cancelled';
  outcome?: string;
  summary?: string;
  error?: string;
  startedAt: string;
  finishedAt?: string;
  latestActivity?: ClientSharedDelegationActivity;
};

const BUILT_IN_AGENT_NAMES: Record<string, string> = {
  'builtin:ask': 'Ask',
  'builtin:code': 'Code',
  'builtin:review': 'Review',
};

const COMPACT_TEXT_LIMIT = 360;

/**
 * Owns the frontend-neutral view of live and settled subagent lifecycles.
 *
 * The control plane remains authoritative for event order and durable child
 * records. This service makes replay idempotent for both clients and keeps raw
 * child transcript/model details out of the UI projection.
 */
export class ClientSharedSessionDelegationService {
  static reduceActivity(
    current: ClientSharedDelegationView[],
    activity: SessionActivity,
  ): ClientSharedDelegationView[] {
    if (activity.type === 'loop.started' || activity.type === 'direct_shell.started') {
      return current.length > 0 ? [] : current;
    }

    if (activity.type === 'delegation.started') {
      if (current.some((candidate) => candidate.delegationId === activity.delegationId)) {
        return current;
      }

      return ClientSharedSessionDelegationService.upsert(current, {
        delegationId: activity.delegationId,
        rootRunId: activity.rootRunId,
        childRunId: activity.childRunId,
        agentProfileId: activity.agentProfileId,
        agentName: ClientSharedSessionDelegationService.formatAgentName(activity.agentProfileId),
        task: activity.task,
        status: 'running',
        startedAt: activity.timestamp,
        latestActivity: { label: 'Starting' },
      });
    }

    if (activity.type === 'delegation.child.activity') {
      const existing = current.find((candidate) => candidate.delegationId === activity.delegationId);
      if (existing && existing.status !== 'running') {
        return current;
      }

      return ClientSharedSessionDelegationService.upsert(current, {
        ...(existing ?? ClientSharedSessionDelegationService.createRunningView(activity)),
        latestActivity: ClientSharedSessionDelegationService.projectChildActivity(activity.activity),
      });
    }

    if (activity.type === 'delegation.finished') {
      const existing = current.find((candidate) => candidate.delegationId === activity.delegationId);
      return ClientSharedSessionDelegationService.upsert(current, {
        ...(existing ?? ClientSharedSessionDelegationService.createRunningView(activity)),
        status: 'finished',
        outcome: activity.outcome,
        ...(activity.summary
          ? { summary: ClientSharedSessionDelegationService.formatCompactText(activity.summary) }
          : {}),
        finishedAt: activity.timestamp,
        latestActivity: undefined,
      });
    }

    if (activity.type === 'delegation.cancelled') {
      const existing = current.find((candidate) => candidate.delegationId === activity.delegationId);
      return ClientSharedSessionDelegationService.upsert(current, {
        ...(existing ?? ClientSharedSessionDelegationService.createRunningView(activity)),
        status: 'cancelled',
        outcome: activity.outcome,
        ...(activity.summary
          ? { summary: ClientSharedSessionDelegationService.formatCompactText(activity.summary) }
          : {}),
        error: activity.error.message,
        finishedAt: activity.timestamp,
        latestActivity: undefined,
      });
    }

    return current;
  }

  static projectSettled(delegations: readonly SettledDelegation[]): ClientSharedDelegationView[] {
    return delegations.map((delegation) => ({
      delegationId: delegation.delegationId,
      rootRunId: delegation.rootRunId,
      childRunId: delegation.childRunId,
      agentProfileId: delegation.agentSnapshot.agentProfileId,
      agentName: delegation.agentSnapshot.agentName,
      task: delegation.task,
      status: delegation.status,
      outcome: delegation.outcome,
      summary: ClientSharedSessionDelegationService.formatCompactText(delegation.summary),
      ...(delegation.failure
        ? { error: `${delegation.failure.source}:${delegation.failure.code}` }
        : {}),
      startedAt: delegation.startedAt,
      finishedAt: delegation.finishedAt,
    }));
  }

  static formatDuration(startedAt: string, finishedAt: string | Date = new Date()): string {
    const start = dayjs(startedAt);
    const finish = dayjs(finishedAt);
    if (!start.isValid() || !finish.isValid()) {
      return '—';
    }

    const elapsedMs = Math.max(0, finish.diff(start));
    const elapsed = dayjs.duration(elapsedMs);
    const hours = Math.floor(elapsed.asHours());
    const minutes = elapsed.minutes();
    const seconds = elapsed.seconds();

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }

    if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    }

    return `${Math.max(1, seconds)}s`;
  }

  static formatCompactText(value: string): string {
    const compact = value.replace(/\s+/g, ' ').trim();
    return compact.length > COMPACT_TEXT_LIMIT
      ? `${compact.slice(0, COMPACT_TEXT_LIMIT - 1).trimEnd()}…`
      : compact;
  }

  private static createRunningView(activity: Extract<
    SessionActivity,
    { type: 'delegation.child.activity' | 'delegation.finished' | 'delegation.cancelled' }
  >): ClientSharedDelegationView {
    return {
      delegationId: activity.delegationId,
      rootRunId: activity.rootRunId,
      childRunId: activity.childRunId,
      agentProfileId: activity.agentProfileId,
      agentName: ClientSharedSessionDelegationService.formatAgentName(activity.agentProfileId),
      task: activity.task,
      status: 'running',
      startedAt: activity.timestamp,
    };
  }

  private static formatAgentName(agentProfileId: string): string {
    return BUILT_IN_AGENT_NAMES[agentProfileId] ?? agentProfileId;
  }

  private static projectChildActivity(
    activity: Extract<SessionActivity, { type: 'delegation.child.activity' }>['activity'],
  ): ClientSharedDelegationActivity {
    if (activity.type === 'assistant.commentary') {
      return { label: 'Working' };
    }

    if (activity.type === 'reasoning.summary') {
      return { label: 'Thinking' };
    }

    if (activity.type === 'assistant.stream') {
      return { label: activity.done ? 'Answer ready' : 'Writing answer' };
    }

    if (activity.type === 'loop.started') {
      return { label: 'Started' };
    }

    const latest = ClientSharedSessionActivityService.resolveLatestUpdate(activity);
    return latest
      ? { label: latest.label, ...(latest.detail ? { detail: latest.detail } : {}) }
      : { label: 'Working' };
  }

  private static upsert(
    current: ClientSharedDelegationView[],
    next: ClientSharedDelegationView,
  ): ClientSharedDelegationView[] {
    const existingIndex = current.findIndex((candidate) => candidate.delegationId === next.delegationId);
    if (existingIndex < 0) {
      return [...current, next];
    }

    return current.map((candidate, index) => index === existingIndex ? next : candidate);
  }
}
