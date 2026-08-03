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
import type {
  HeartbeatTask,
  HeartbeatTaskContinuationMode,
  HeartbeatTaskExecution,
  HeartbeatTaskExecutionOutcome,
  HeartbeatTaskRecovery,
  HeartbeatTaskRecoveryReason,
  HeartbeatTaskState,
  HeartbeatTaskStatus,
} from './types.js';

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
    execution: HeartbeatTaskExecution;
  }): HeartbeatTask {
    const runRequest = args.task.state?.runRequest;
    const claimsPendingRequest = HeartbeatTaskStateProjector.hasPendingRunRequest(args.task);
    const execution = claimsPendingRequest && runRequest ? {
      ...args.execution,
      runRequestGeneration: runRequest.generation,
    } : args.execution;

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
        execution,
        runRequest: claimsPendingRequest && runRequest ? {
          ...runRequest,
          claimedGeneration: runRequest.generation,
        } : runRequest,
        updatedAt: dayjs(args.now).toISOString(),
      },
    });
  }

  static requestRun(args: {
    task: HeartbeatTask;
    now: Date;
    reason?: string;
  }): {
    task: HeartbeatTask;
    disposition: 'requested' | 'coalesced';
  } {
    const previousRequest = args.task.state?.runRequest;
    const generation = (previousRequest?.generation ?? 0) + 1;
    if (!Number.isSafeInteger(generation)) {
      throw new Error(`Heartbeat task ${args.task.id} run-request generation is exhausted.`);
    }

    const requestedAt = dayjs(args.now).toISOString();
    const disposition = HeartbeatTaskStateProjector.hasPendingRunRequest(args.task) ? 'coalesced' : 'requested';
    const running = args.task.state?.status === 'running';
    const task = HeartbeatTaskStateProjector.normalize({
      ...args.task,
      schedule: {
        ...args.task.schedule,
        nextRunAt: dayjs(args.now).subtract(1, 'second').toISOString(),
      },
      state: {
        ...args.task.state,
        status: running ? 'running' : 'waiting',
        progress: running ?
          args.task.state?.progress
        : 'Heartbeat run requested. Waiting for the scheduler.',
        runRequest: {
          generation,
          claimedGeneration: previousRequest?.claimedGeneration ?? 0,
          requestedAt,
          reason: args.reason,
        },
        updatedAt: requestedAt,
      },
    });

    return { task, disposition };
  }

  static hasPendingRunRequest(task: Pick<HeartbeatTask, 'state'>): boolean {
    const request = task.state?.runRequest;
    return Boolean(request && request.generation > request.claimedGeneration);
  }

  static afterRecovery(args: {
    task: HeartbeatTask;
    now: Date;
    reason: HeartbeatTaskRecoveryReason;
  }): { task: HeartbeatTask; recovery: HeartbeatTaskRecovery } {
    const execution = args.task.state?.execution;
    if (!execution) {
      throw new Error(`Heartbeat task ${args.task.id} has no execution to recover.`);
    }

    const recoveredAt = dayjs(args.now).toISOString();
    const recovery: HeartbeatTaskRecovery = {
      interruptedExecutionId: execution.executionId,
      interruptedOwnerId: execution.ownerId,
      recoveredAt,
      reason: args.reason,
    };
    const task = HeartbeatTaskStateProjector.normalize({
      ...args.task,
      schedule: {
        ...args.task.schedule,
        nextRunAt: args.task.enabled ? dayjs(args.now).subtract(1, 'second').toISOString() : undefined,
      },
      state: {
        ...args.task.state,
        status: args.task.enabled ? 'waiting' : 'idle',
        progress:
          args.task.enabled ?
            'Recovered an interrupted heartbeat execution. Waiting for retry.'
          : 'Recovered an interrupted heartbeat execution. Task remains disabled.',
        execution: undefined,
        recovery,
        updatedAt: recoveredAt,
      },
    });

    return { task, recovery };
  }

  static afterResult(args: {
    task: HeartbeatTask;
    execution: HeartbeatTaskExecution;
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

    return HeartbeatTaskStateProjector.afterExecutionSettlement(HeartbeatTaskStateProjector.normalize({
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
        runRequest: args.task.state?.runRequest,
        lastExecution: HeartbeatTaskStateProjector.executionOutcome({
          kind: 'agent',
          execution: args.execution,
          summary: args.result.summary,
          finishedAt: dayjs(args.now).toISOString(),
        }),
        recovery: args.task.state?.recovery,
        updatedAt: dayjs(args.now).toISOString(),
      },
    }));
  }

  static afterFailure(args: {
    task: HeartbeatTask;
    execution: HeartbeatTaskExecution;
    error: unknown;
    now: Date;
    retryMs: number;
  }): HeartbeatTask {
    const summary = args.error instanceof Error ? args.error.message : String(args.error);
    return HeartbeatTaskStateProjector.afterExecutionSettlement(HeartbeatTaskStateProjector.normalize({
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
        error: summary,
        execution: undefined,
        lastExecution: HeartbeatTaskStateProjector.executionOutcome({
          kind: 'failed',
          execution: args.execution,
          summary,
          finishedAt: dayjs(args.now).toISOString(),
        }),
        updatedAt: dayjs(args.now).toISOString(),
      },
    }));
  }

  static afterSkip(args: {
    task: HeartbeatTask;
    execution: HeartbeatTaskExecution;
    summary: string;
    now: Date;
  }): HeartbeatTask {
    const finishedAt = dayjs(args.now).toISOString();
    return HeartbeatTaskStateProjector.afterExecutionSettlement(HeartbeatTaskStateProjector.normalize({
      ...args.task,
      schedule: {
        ...args.task.schedule,
        nextRunAt: args.task.enabled ? dayjs(args.now).add(args.task.schedule.intervalMs, 'millisecond').toISOString() : undefined,
      },
      state: {
        status: args.task.enabled ? 'waiting' : 'idle',
        progress: args.task.enabled ?
          `No work was available. Waiting until the next scheduled run in ${HeartbeatTaskStateProjector.formatDelay(args.task.schedule.intervalMs)}.`
        : 'No work was available. Task remains disabled.',
        runAt: finishedAt,
        resumable: true,
        error: undefined,
        execution: undefined,
        runRequest: args.task.state?.runRequest,
        lastExecution: HeartbeatTaskStateProjector.executionOutcome({
          kind: 'skipped',
          execution: args.execution,
          summary: args.summary,
          finishedAt,
        }),
        recovery: args.task.state?.recovery,
        updatedAt: finishedAt,
      },
    }));
  }

  static afterCancellation(args: {
    task: HeartbeatTask;
    execution: HeartbeatTaskExecution;
    summary: string;
    now: Date;
  }): HeartbeatTask {
    const finishedAt = dayjs(args.now).toISOString();
    return HeartbeatTaskStateProjector.afterExecutionSettlement(HeartbeatTaskStateProjector.normalize({
      ...args.task,
      schedule: {
        ...args.task.schedule,
        nextRunAt: args.task.enabled ? dayjs(args.now).subtract(1, 'second').toISOString() : undefined,
      },
      state: {
        status: args.task.enabled ? 'waiting' : 'idle',
        progress: args.task.enabled ?
          'Heartbeat execution was cancelled. Waiting for retry.'
        : 'Heartbeat execution was cancelled. Task remains disabled.',
        runAt: finishedAt,
        resumable: true,
        error: undefined,
        execution: undefined,
        runRequest: args.task.state?.runRequest,
        lastExecution: HeartbeatTaskStateProjector.executionOutcome({
          kind: 'cancelled',
          execution: args.execution,
          summary: args.summary,
          finishedAt,
        }),
        recovery: args.task.state?.recovery,
        updatedAt: finishedAt,
      },
    }));
  }

  private static normalizeState(state: HeartbeatTaskState | undefined): HeartbeatTaskState {
    return {
      ...state,
      status: state?.status ?? 'idle',
      resumable: state?.resumable ?? true,
    };
  }

  private static afterExecutionSettlement(task: HeartbeatTask): HeartbeatTask {
    const runRequest = task.state?.runRequest;
    if (!task.enabled) {
      const terminal = task.state?.status === 'blocked' || task.state?.status === 'complete';
      return HeartbeatTaskStateProjector.normalize({
        ...task,
        schedule: {
          ...task.schedule,
          nextRunAt: undefined,
        },
        state: {
          ...task.state,
          status: terminal ? task.state?.status : 'idle',
          progress: terminal ? task.state?.progress : 'Heartbeat execution settled. Task remains disabled.',
          runRequest: runRequest ? {
            ...runRequest,
            claimedGeneration: runRequest.generation,
          } : undefined,
        },
      });
    }

    if (!runRequest || !HeartbeatTaskStateProjector.hasPendingRunRequest(task)) {
      return task;
    }

    if (task.state?.status === 'blocked' || task.state?.status === 'complete') {
      return HeartbeatTaskStateProjector.normalize({
        ...task,
        schedule: {
          ...task.schedule,
          nextRunAt: undefined,
        },
        state: {
          ...task.state,
          runRequest: {
            ...runRequest,
            claimedGeneration: runRequest.generation,
          },
        },
      });
    }

    return HeartbeatTaskStateProjector.normalize({
      ...task,
      schedule: {
        ...task.schedule,
        nextRunAt: dayjs(runRequest.requestedAt).subtract(1, 'second').toISOString(),
      },
      state: {
        ...task.state,
        status: 'waiting',
        progress: 'A newer heartbeat run was requested during this execution. Waiting for an immediate follow-up.',
      },
    });
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

  private static executionOutcome(args: {
    kind: HeartbeatTaskExecutionOutcome['kind'];
    execution: HeartbeatTaskExecution;
    summary: string;
    finishedAt: string;
  }): HeartbeatTaskExecutionOutcome {
    return {
      kind: args.kind,
      executionId: args.execution.executionId,
      summary: args.summary,
      finishedAt: args.finishedAt,
      runRequestGeneration: args.execution.runRequestGeneration,
    };
  }
}
