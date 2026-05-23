import dayjs from 'dayjs';
import type { ControlPlaneHeartbeatRunView, ControlPlaneHeartbeatTaskView } from '@web/api/client';

export const TASK_STATUS_TONE = {
  idle: 'muted',
  running: 'active',
  waiting: 'muted',
  blocked: 'warning',
  complete: 'success',
  failed: 'danger',
} as const satisfies Record<ControlPlaneHeartbeatTaskView['state']['status'], 'active' | 'danger' | 'muted' | 'success' | 'warning'>;

export function taskDisplayName(task: Pick<ControlPlaneHeartbeatTaskView, 'name' | 'task'>): string {
  return task.name ?? task.task;
}

export function formatTaskInterval(intervalMs: number | undefined): string {
  if (!intervalMs) {
    return 'not scheduled';
  }

  const minutes = Math.round(intervalMs / 60_000);
  if (minutes < 60) {
    return `every ${minutes}m`;
  }

  const hours = Math.round(minutes / 60);
  return `every ${hours}h`;
}

export function formatTaskTimestamp(value: string | undefined): string {
  return value ? dayjs(value).format('MMM D, YYYY HH:mm') : 'none';
}

export function runDisplaySummary(run: ControlPlaneHeartbeatRunView): string {
  return run.result.summary || run.result.outcome || run.task.state.progress || run.result.decision;
}

export function formatUsage(usage: ControlPlaneHeartbeatRunView['result']['usage']): string {
  if (!usage) {
    return 'none';
  }

  return [
    usage.inputTokens !== undefined ? `${usage.inputTokens.toLocaleString()} input` : undefined,
    usage.outputTokens !== undefined ? `${usage.outputTokens.toLocaleString()} output` : undefined,
    usage.totalTokens !== undefined ? `${usage.totalTokens.toLocaleString()} total` : undefined,
  ].filter(Boolean).join(' · ') || 'none';
}
