/**
 * Heartbeat scheduler service.
 *
 * Owns scheduler lifecycle, periodic polling, and due-task selection. It does
 * not execute tasks directly; selected task execution is delegated to
 * `HeartbeatTaskRunnerService`.
 */
import { FileHeartbeatTaskService, type HeartbeatTask, type HeartbeatTaskRunRecord } from '../tasks/index.js';
import { HeartbeatTaskRunnerService } from './runner.js';
import type {
  HeartbeatSchedulerHandle,
  RunDueHeartbeatTasksOptions,
  RunDueHeartbeatTasksResult,
  RunHeartbeatSchedulerOptions,
  StartHeartbeatSchedulerOptions,
} from './types.js';

const DEFAULT_SCHEDULER_POLL_INTERVAL_MS = 60_000;

export class HeartbeatSchedulerService {
  // Starts a background scheduler loop for one workspace and returns a handle the host can stop.
  static start(options: StartHeartbeatSchedulerOptions): HeartbeatSchedulerHandle {
    const controller = new AbortController();
    const store = new FileHeartbeatTaskService({ stateRoot: options.stateRoot });
    void HeartbeatSchedulerService.runLoop({
      store,
      runtime: {
        workspaceRoot: options.workspaceRoot,
        stateDir: options.stateRoot,
        preferApiKey: options.preferApiKey,
        model: options.model,
        maxSteps: options.maxSteps,
        searchIgnoreDirs: options.searchIgnoreDirs,
        systemContext: options.systemContext,
        onAgentEvent: options.onAgentEvent,
      },
      pollIntervalMs: options.pollIntervalMs ?? DEFAULT_SCHEDULER_POLL_INTERVAL_MS,
      signal: controller.signal,
      onEvent: options.onEvent,
    }).catch((error: unknown) => {
      options.onError?.(error);
    });

    return {
      stop: () => controller.abort(),
    };
  }

  // Checks all stored tasks once, picks enabled tasks whose nextRunAt is due, and delegates each selected task to the runner service.
  static async runDueTasks(options: RunDueHeartbeatTasksOptions): Promise<RunDueHeartbeatTasksResult> {
    const now = options.now?.() ?? new Date();
    const tasks = await options.store.listTasks();
    const dueTasks = tasks.filter((task) => HeartbeatSchedulerService.isTaskDue(task, now));
    const records: HeartbeatTaskRunRecord[] = [];
    let failed = 0;

    for (const task of dueTasks) {
      options.onEvent?.({ type: 'heartbeat.task.due', taskId: task.id, timestamp: now.toISOString() });
      const result = await HeartbeatTaskRunnerService.runTask({ ...options, task, runAt: now });
      if (result.record) {
        records.push(result.record);
      }
      if (result.failed) {
        failed++;
      }
    }

    return {
      checked: tasks.length,
      ran: records.length,
      failed,
      records,
    };
  }

  // Repeats due-task checks until the host aborts the loop.
  static async runLoop(options: RunHeartbeatSchedulerOptions): Promise<void> {
    options.onEvent?.({ type: 'heartbeat.scheduler.started', timestamp: (options.now?.() ?? new Date()).toISOString() });
    try {
      while (!options.signal?.aborted) {
        await HeartbeatSchedulerService.runDueTasks(options);
        await (options.sleep ?? HeartbeatSchedulerService.sleep)(options.pollIntervalMs ?? DEFAULT_SCHEDULER_POLL_INTERVAL_MS, options.signal);
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

  // Decides whether a task should be selected by the scheduler at the current time.
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

  // Sleeps between polling cycles and resolves early when the host aborts the scheduler.
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
