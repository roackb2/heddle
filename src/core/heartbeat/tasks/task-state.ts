/**
 * Heartbeat task state projector.
 *
 * Owns how wake results and failures become durable scheduler-facing task
 * state. This keeps status/progress text out of CLI, server, and scheduler
 * loops.
 */
import type { AgentHeartbeatResult } from '../wake/index.js';
import { HeartbeatDecisionPolicy } from '../wake/index.js';
import type { HeartbeatTask, HeartbeatTaskState, HeartbeatTaskStatus } from './types.js';

export class HeartbeatTaskStateProjector {
  static normalize(task: HeartbeatTask): HeartbeatTask {
    return {
      ...task,
      schedule: {
        ...task.schedule,
        intervalMs: Math.max(1, Math.trunc(task.schedule.intervalMs)),
      },
      state: HeartbeatTaskStateProjector.normalizeState(task.state),
    };
  }

  static markRunning(args: {
    task: HeartbeatTask;
    now: Date;
    loadedCheckpoint: boolean;
  }): HeartbeatTask {
    return HeartbeatTaskStateProjector.normalize({
      ...args.task,
      state: {
        ...args.task.state,
        status: 'running',
        progress:
          args.loadedCheckpoint ?
            'Resuming heartbeat wake from the last checkpoint.'
          : 'Starting a new heartbeat wake cycle.',
        loadedCheckpoint: args.loadedCheckpoint,
        error: undefined,
        updatedAt: args.now.toISOString(),
      },
    });
  }

  static afterResult(args: {
    task: HeartbeatTask;
    result: AgentHeartbeatResult;
    now: Date;
    loadedCheckpoint: boolean;
  }): HeartbeatTask {
    const terminal = args.result.decision === 'complete' || args.result.decision === 'escalate';
    const delayMs =
      terminal ? undefined
      : args.result.decision === 'continue' ? args.task.schedule.intervalMs
      : HeartbeatDecisionPolicy.suggestNextDelayMs(args.result.decision) ?? args.task.schedule.intervalMs;
    const projection = HeartbeatTaskStateProjector.projectResult(args.result, delayMs);

    return HeartbeatTaskStateProjector.normalize({
      ...args.task,
      enabled: terminal ? false : args.task.enabled,
      schedule: {
        ...args.task.schedule,
        nextRunAt: delayMs === undefined ? undefined : new Date(args.now.getTime() + delayMs).toISOString(),
      },
      state: {
        status: projection.status,
        progress: projection.progress,
        runAt: args.now.toISOString(),
        runId: args.result.state.runId,
        loadedCheckpoint: args.loadedCheckpoint,
        resumable: args.result.decision !== 'complete',
        result: args.result,
        error: undefined,
        updatedAt: args.now.toISOString(),
      },
    });
  }

  static afterFailure(args: {
    task: HeartbeatTask;
    error: unknown;
    now: Date;
    retryMs: number;
  }): HeartbeatTask {
    return HeartbeatTaskStateProjector.normalize({
      ...args.task,
      schedule: {
        ...args.task.schedule,
        nextRunAt: new Date(args.now.getTime() + args.retryMs).toISOString(),
      },
      state: {
        ...args.task.state,
        status: 'failed',
        progress: 'Heartbeat wake failed and will retry later.',
        runAt: args.now.toISOString(),
        error: args.error instanceof Error ? args.error.message : String(args.error),
        updatedAt: args.now.toISOString(),
      },
    });
  }

  private static normalizeState(state: HeartbeatTaskState | undefined): HeartbeatTaskState {
    return {
      ...state,
      status: state?.status ?? 'idle',
      resumable: state?.resumable ?? true,
    };
  }

  private static projectResult(
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
            : `Heartbeat wake finished. Waiting until the next scheduled run in ${HeartbeatTaskStateProjector.formatDelay(delayMs)}.`,
        };
      case 'pause':
        return {
          status: 'waiting',
          progress:
            delayMs === undefined ?
              'Heartbeat paused.'
            : `Heartbeat paused. Waiting ${HeartbeatTaskStateProjector.formatDelay(delayMs)} before the next wake.`,
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

  private static formatDelay(ms: number): string {
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
}
