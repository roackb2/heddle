/**
 * Heartbeat scheduler service.
 *
 * Owns due-task selection, scheduler lifecycle events, checkpoint persistence,
 * task state projection, and run-record persistence.
 */
import { HeartbeatTaskStateProjector } from '../tasks/index.js';
import type { HeartbeatTask, HeartbeatTaskRunRecord } from '../tasks/index.js';
import { HeartbeatTaskRunnerService } from './runner.js';
import type {
  RunDueHeartbeatTasksOptions,
  RunDueHeartbeatTasksResult,
  RunHeartbeatSchedulerOptions,
} from './types.js';

const DEFAULT_FAILURE_RETRY_MS = 5 * 60_000;

export class HeartbeatSchedulerService {
  static async runDueTasks(options: RunDueHeartbeatTasksOptions): Promise<RunDueHeartbeatTasksResult> {
    const now = options.now?.() ?? new Date();
    const tasks = await options.store.listTasks();
    const dueTasks = tasks.filter((task) => HeartbeatSchedulerService.isTaskDue(task, now));
    const records: HeartbeatTaskRunRecord[] = [];
    let failed = 0;

    for (const task of dueTasks) {
      options.onEvent?.({ type: 'heartbeat.task.due', taskId: task.id, timestamp: now.toISOString() });
      try {
        const checkpoint = await options.store.loadCheckpoint(task);
        const loadedCheckpoint = Boolean(checkpoint);
        const runningTask = HeartbeatTaskStateProjector.markRunning({
          task,
          now,
          loadedCheckpoint,
        });
        await options.store.saveTask(runningTask);
        options.onEvent?.({
          type: 'heartbeat.task.started',
          taskId: task.id,
          loadedCheckpoint,
          status: runningTask.state?.status ?? 'running',
          progress: runningTask.state?.progress ?? '',
          timestamp: now.toISOString(),
        });

        const result = options.runner ?
          await options.runner(task, checkpoint)
        : await HeartbeatTaskRunnerService.run({ task, checkpoint, heartbeat: options.heartbeat });
        await options.store.saveCheckpoint(task, result.checkpoint);
        const nextTask = HeartbeatTaskStateProjector.afterResult({
          task,
          result,
          now,
          loadedCheckpoint,
        });
        await options.store.saveTask(nextTask);
        const record = { task: nextTask, result, loadedCheckpoint };
        await options.store.saveRunRecord?.(record);
        records.push(record);
        options.onEvent?.({
          type: 'heartbeat.task.finished',
          taskId: task.id,
          record,
          timestamp: now.toISOString(),
        });
      } catch (error) {
        failed++;
        const nextTask = HeartbeatTaskStateProjector.afterFailure({
          task,
          error,
          now,
          retryMs: options.failureRetryMs ?? DEFAULT_FAILURE_RETRY_MS,
        });
        await options.store.saveTask(nextTask);
        options.onEvent?.({
          type: 'heartbeat.task.failed',
          taskId: task.id,
          error: error instanceof Error ? error.message : String(error),
          status: nextTask.state?.status ?? 'failed',
          progress: nextTask.state?.progress ?? '',
          nextRunAt: nextTask.schedule.nextRunAt,
          timestamp: now.toISOString(),
        });
      }
    }

    return {
      checked: tasks.length,
      ran: records.length,
      failed,
      records,
    };
  }

  static async runLoop(options: RunHeartbeatSchedulerOptions): Promise<void> {
    options.onEvent?.({ type: 'heartbeat.scheduler.started', timestamp: (options.now?.() ?? new Date()).toISOString() });
    try {
      while (!options.signal?.aborted) {
        await HeartbeatSchedulerService.runDueTasks(options);
        await (options.sleep ?? HeartbeatSchedulerService.sleep)(options.pollIntervalMs ?? 60_000, options.signal);
      }
      options.onEvent?.({ type: 'heartbeat.scheduler.stopped', reason: 'aborted', timestamp: (options.now?.() ?? new Date()).toISOString() });
    } catch (error) {
      if (options.signal?.aborted) {
        options.onEvent?.({ type: 'heartbeat.scheduler.stopped', reason: 'aborted', timestamp: (options.now?.() ?? new Date()).toISOString() });
        return;
      }

      options.onEvent?.({ type: 'heartbeat.scheduler.stopped', reason: 'error', timestamp: (options.now?.() ?? new Date()).toISOString() });
      throw error;
    }
  }

  private static isTaskDue(task: HeartbeatTask, now: Date): boolean {
    if (!task.enabled) {
      return false;
    }

    if (!task.schedule.nextRunAt) {
      return true;
    }

    const nextRunAt = Date.parse(task.schedule.nextRunAt);
    return Number.isFinite(nextRunAt) && nextRunAt <= now.getTime();
  }

  private static sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(resolve, ms);
      signal?.addEventListener('abort', () => {
        clearTimeout(timeout);
        resolve();
      }, { once: true });
    });
  }
}
