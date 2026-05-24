import dayjs from 'dayjs';
import duration from 'dayjs/plugin/duration.js';
import type { ControlPlaneHeartbeatRunView, ControlPlaneHeartbeatTaskView } from '@web/api/client';

dayjs.extend(duration);

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

  const interval = dayjs.duration(intervalMs);
  const minutes = Math.round(interval.asMinutes());
  if (minutes < 60) {
    return `every ${minutes}m`;
  }

  const hours = Math.round(dayjs.duration(minutes, 'minutes').asHours());
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
