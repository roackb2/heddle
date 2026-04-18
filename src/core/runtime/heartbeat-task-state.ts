import type { AgentHeartbeatResult } from './heartbeat.js';
import { suggestNextHeartbeatDelayMs } from './heartbeat-store.js';
import type { HeartbeatTask, HeartbeatTaskStatus } from './heartbeat-task-store.js';
import { normalizeTaskForSave } from './heartbeat-task-store.js';

export function updateTaskAfterResult(
  task: HeartbeatTask,
  result: AgentHeartbeatResult,
  now: Date,
  loadedCheckpoint: boolean,
): HeartbeatTask {
  const terminal = result.decision === 'complete' || result.decision === 'escalate';
  const delayMs =
    terminal ? undefined
    : result.decision === 'continue' ? task.intervalMs
    : suggestNextHeartbeatDelayMs(result.decision) ?? task.intervalMs;
  const projection = projectionForResult(result, delayMs);

  return normalizeTaskForSave({
    ...task,
    enabled: terminal ? false : task.enabled,
    status: projection.status,
    lastProgress: projection.progress,
    nextRunAt: delayMs === undefined ? undefined : new Date(now.getTime() + delayMs).toISOString(),
    lastRunAt: now.toISOString(),
    lastRunId: result.state.runId,
    lastLoadedCheckpoint: loadedCheckpoint,
    resumable: result.decision !== 'complete',
    lastUsage: result.state.usage,
    lastDecision: result.decision,
    lastOutcome: result.state.outcome,
    lastSummary: result.summary,
    lastError: undefined,
    updatedAt: now.toISOString(),
  });
}

export function updateTaskAfterFailure(task: HeartbeatTask, error: unknown, now: Date, retryMs: number): HeartbeatTask {
  return normalizeTaskForSave({
    ...task,
    status: 'failed',
    lastProgress: 'Heartbeat wake failed and will retry later.',
    nextRunAt: new Date(now.getTime() + retryMs).toISOString(),
    lastRunAt: now.toISOString(),
    lastError: error instanceof Error ? error.message : String(error),
    updatedAt: now.toISOString(),
  });
}

function projectionForResult(
  result: AgentHeartbeatResult,
  delayMs: number | undefined,
): { status: HeartbeatTaskStatus; progress: string } {
  switch (result.decision) {
    case 'continue':
      return {
        status: 'waiting',
        progress:
          delayMs === undefined ?
            'Heartbeat wake finished.'
          : `Heartbeat wake finished. Waiting until the next scheduled run in ${formatDelay(delayMs)}.`,
      };
    case 'pause':
      return {
        status: 'waiting',
        progress:
          delayMs === undefined ?
            'Heartbeat paused.'
          : `Heartbeat paused. Waiting ${formatDelay(delayMs)} before the next wake.`,
      };
    case 'complete':
      return {
        status: 'complete',
        progress: 'Heartbeat task completed and will not wake again.',
      };
    case 'escalate':
      return {
        status: 'blocked',
        progress: 'Heartbeat escalated for user input and is waiting for follow-up.',
      };
  }
}

function formatDelay(ms: number): string {
  if (ms % (24 * 60 * 60_000) === 0) {
    return `${ms / (24 * 60 * 60_000)}d`;
  }
  if (ms % (60 * 60_000) === 0) {
    return `${ms / (60 * 60_000)}h`;
  }
  if (ms % 60_000 === 0) {
    return `${ms / 60_000}m`;
  }
  if (ms % 1_000 === 0) {
    return `${ms / 1_000}s`;
  }
  return `${ms}ms`;
}
