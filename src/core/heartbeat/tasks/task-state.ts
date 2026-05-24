/**
 * Heartbeat task state projector.
 *
 * Owns how runner results and failures become durable scheduler-facing task
 * state. This keeps status/progress text out of CLI, server, and scheduler
 * loops.
 */
import dayjs from 'dayjs';
import duration from 'dayjs/plugin/duration.js';
import type { AgentHeartbeatResult } from '../agent/index.js';
import { HeartbeatDecisionPolicy } from '../agent/index.js';
import type { HeartbeatTask, HeartbeatTaskContinuationMode, HeartbeatTaskState, HeartbeatTaskStatus } from './types.js';

dayjs.extend(duration);

export class HeartbeatTaskStateProjector {
  static normalize(task: HeartbeatTask): HeartbeatTask {
    return {
      ...task,
      continuationMode: task.continuationMode ?? 'operator',
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
            'Resuming heartbeat runner from the last checkpoint.'
          : 'Starting a new heartbeat runner cycle.',
        loadedCheckpoint: args.loadedCheckpoint,
        error: undefined,
        updatedAt: dayjs(args.now).toISOString(),
      },
    });
  }

  static afterResult(args: {
    task: HeartbeatTask;
    result: AgentHeartbeatResult;
    now: Date;
    loadedCheckpoint: boolean;
  }): HeartbeatTask {
    const continuationMode = args.task.continuationMode ?? 'operator';
    const terminal = HeartbeatTaskStateProjector.isTerminalDecision(args.result.decision, continuationMode);
    const delayMs = HeartbeatTaskStateProjector.nextDelayMs({
      decision: args.result.decision,
      intervalMs: args.task.schedule.intervalMs,
      continuationMode,
      terminal,
    });
    const projection = HeartbeatTaskStateProjector.projectResult(args.result, delayMs);

    return HeartbeatTaskStateProjector.normalize({
      ...args.task,
      enabled: terminal ? false : args.task.enabled,
      schedule: {
        ...args.task.schedule,
        nextRunAt: delayMs === undefined ? undefined : dayjs(args.now).add(delayMs, 'millisecond').toISOString(),
      },
      state: {
        status: projection.status,
        progress: projection.progress,
        runAt: dayjs(args.now).toISOString(),
        runId: args.result.state.runId,
        loadedCheckpoint: args.loadedCheckpoint,
        resumable: args.result.decision !== 'complete' || continuationMode === 'operator',
        result: args.result,
        error: undefined,
        updatedAt: dayjs(args.now).toISOString(),
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
        nextRunAt: dayjs(args.now).add(args.retryMs, 'millisecond').toISOString(),
      },
      state: {
        ...args.task.state,
        status: 'failed',
        progress: 'Heartbeat runner failed and will retry later.',
        runAt: dayjs(args.now).toISOString(),
        error: args.error instanceof Error ? args.error.message : String(args.error),
        updatedAt: dayjs(args.now).toISOString(),
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
              'Heartbeat runner finished.'
            : `Heartbeat runner finished. Waiting until the next scheduled run in ${HeartbeatTaskStateProjector.formatDelay(delayMs)}.`,
        };
      case 'pause':
        return {
          status: 'waiting',
          progress:
            delayMs === undefined ?
              'Heartbeat paused.'
            : `Heartbeat paused. Waiting ${HeartbeatTaskStateProjector.formatDelay(delayMs)} before the next run.`,
        };
      case 'complete':
        if (delayMs !== undefined) {
          return {
            status: 'waiting',
            progress: `Heartbeat runner reported completion. Waiting until the next scheduled run in ${HeartbeatTaskStateProjector.formatDelay(delayMs)}.`,
          };
        }

        return {
          status: 'complete',
          progress: 'Heartbeat task completed and will not run again.',
        };
      case 'escalate':
        return {
          status: 'blocked',
          progress: 'Heartbeat escalated for user input and is waiting for follow-up.',
        };
    }
  }

  private static isTerminalDecision(
    decision: AgentHeartbeatResult['decision'],
    continuationMode: HeartbeatTaskContinuationMode,
  ): boolean {
    return decision === 'escalate' || (continuationMode === 'agent' && decision === 'complete');
  }

  private static nextDelayMs(args: {
    decision: AgentHeartbeatResult['decision'];
    intervalMs: number;
    continuationMode: HeartbeatTaskContinuationMode;
    terminal: boolean;
  }): number | undefined {
    if (args.terminal) {
      return undefined;
    }

    if (args.continuationMode === 'operator') {
      return args.intervalMs;
    }

    return args.decision === 'continue' ?
      args.intervalMs
    : HeartbeatDecisionPolicy.suggestNextDelayMs(args.decision) ?? args.intervalMs;
  }

  private static formatDelay(ms: number): string {
    const delay = dayjs.duration(ms);
    if (delay.asMilliseconds() % dayjs.duration(1, 'day').asMilliseconds() === 0) {
      return `${delay.asDays()}d`;
    }
    if (delay.asMilliseconds() % dayjs.duration(1, 'hour').asMilliseconds() === 0) {
      return `${delay.asHours()}h`;
    }
    if (delay.asMilliseconds() % dayjs.duration(1, 'minute').asMilliseconds() === 0) {
      return `${delay.asMinutes()}m`;
    }
    if (delay.asMilliseconds() % dayjs.duration(1, 'second').asMilliseconds() === 0) {
      return `${delay.asSeconds()}s`;
    }
    return `${ms}ms`;
  }
}
