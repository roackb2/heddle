/**
 * Heartbeat scheduler service.
 *
 * Owns scheduler lifecycle, periodic polling, and due-task selection. It does
 * not execute tasks directly; selected task execution is delegated to
 * `HeartbeatTaskRunnerService`.
 */
import { randomUUID } from 'node:crypto';
import dayjs from 'dayjs';
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore.js';
import {
  FileHeartbeatTaskService,
  type HeartbeatTask,
  type HeartbeatTaskRunRecord,
  type HeartbeatTaskRunRequestSignal,
  type HeartbeatTaskStore,
} from '../tasks/index.js';
import { HeartbeatTaskRunnerService } from './runner.js';
import type {
  HeartbeatSchedulerHandle,
  RunDueHeartbeatTasksOptions,
  RunDueHeartbeatTasksResult,
  RunHeartbeatSchedulerOptions,
  StartHeartbeatSchedulerOptions,
} from './types.js';

const DEFAULT_SCHEDULER_POLL_INTERVAL_MS = 60_000;

dayjs.extend(isSameOrBefore);

class HeartbeatSchedulerWakeController {
  private readonly pendingRequests = new Map<string, HeartbeatTaskRunRequestSignal>();
  private readonly unsubscribe?: () => void;
  private waitController = new AbortController();

  constructor(store: HeartbeatTaskStore) {
    this.unsubscribe = store.subscribeToRunRequests?.((request) => {
      this.pendingRequests.set(request.taskId, request);
      this.waitController.abort();
    });
  }

  drain(): HeartbeatTaskRunRequestSignal[] {
    const requests = [...this.pendingRequests.values()]
      .sort((left, right) => left.taskId.localeCompare(right.taskId));
    this.pendingRequests.clear();
    return requests;
  }

  async wait(args: {
    intervalMs: number;
    signal?: AbortSignal;
    sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  }): Promise<void> {
    const cycleController = this.waitController;
    const signal = args.signal ? AbortSignal.any([args.signal, cycleController.signal]) : cycleController.signal;
    await args.sleep(args.intervalMs, signal);
    if (this.waitController === cycleController) {
      this.waitController = new AbortController();
    }
  }

  dispose(): void {
    this.unsubscribe?.();
    this.waitController.abort();
    this.pendingRequests.clear();
  }
}

export class HeartbeatSchedulerService {
  // Starts a background scheduler loop for one workspace and returns a handle the host can stop.
  static start(options: StartHeartbeatSchedulerOptions): HeartbeatSchedulerHandle {
    HeartbeatTaskRunnerService.assertHandlerConfiguration(options);
    const loopController = new AbortController();
    const executionController = new AbortController();
    const store = new FileHeartbeatTaskService({ stateRoot: options.stateRoot });
    let loopError: unknown;
    const settledLoop = HeartbeatSchedulerService.runLoop({
      store,
      handler: options.handler,
      runner: options.runner,
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
      signal: loopController.signal,
      executionSignal: executionController.signal,
      onEvent: options.onEvent,
    }).catch((error: unknown) => {
      loopError = error;
      try {
        options.onError?.(error);
      } catch {
        // A host error callback must not create an unhandled scheduler promise.
      }
    });
    let stopPromise: Promise<void> | undefined;

    return {
      stop: (stopOptions = {}) => {
        loopController.abort();
        if (stopOptions.cancelRunning) {
          executionController.abort();
        }
        stopPromise ??= settledLoop.then(() => {
          if (loopError) {
            throw loopError;
          }
        });
        return stopPromise;
      },
    };
  }

  // Scans stored tasks once, picks enabled tasks whose nextRunAt is due, and delegates each selected task to the runner service.
  static async runDueTasks(options: RunDueHeartbeatTasksOptions): Promise<RunDueHeartbeatTasksResult> {
    HeartbeatTaskRunnerService.assertHandlerConfiguration(options);
    const now = options.now?.() ?? dayjs().toDate();
    const timestamp = dayjs(now).toISOString();
    const tasks = await options.store.listTasks();
    const dueTasks = tasks.filter((task) => HeartbeatSchedulerService.isTaskDue(task, now));
    const records: HeartbeatTaskRunRecord[] = [];
    let checked = 0;
    let failed = 0;
    const executionOwnerId = options.executionOwnerId ?? HeartbeatSchedulerService.createExecutionOwnerId();

    for (const task of dueTasks) {
      if ((options.admissionSignal ?? options.signal)?.aborted) {
        break;
      }
      checked++;
      options.onEvent?.({ type: 'heartbeat.task.due', taskId: task.id, timestamp });
      const result = await HeartbeatTaskRunnerService.runTask({ ...options, executionOwnerId, task, runAt: now });
      if (result.record) {
        records.push(result.record);
      }
      if (result.failed) {
        failed++;
      }
    }

    return {
      checked,
      ran: records.length,
      failed,
      records,
    };
  }

  // Repeats due-task checks until the host aborts the loop.
  static async runLoop(options: RunHeartbeatSchedulerOptions): Promise<void> {
    const executionOwnerId = options.executionOwnerId ?? HeartbeatSchedulerService.createExecutionOwnerId();
    const startedAt = options.now?.() ?? dayjs().toDate();
    const wakeController = new HeartbeatSchedulerWakeController(options.store);
    options.onEvent?.({ type: 'heartbeat.scheduler.started', timestamp: dayjs(startedAt).toISOString() });
    try {
      const recoveries = await options.store.recoverInterruptedTasks({
        ownerId: executionOwnerId,
        recoveredAt: startedAt,
        reason: 'host-restart',
      });
      recoveries.forEach(({ task, recovery }) => options.onEvent?.({
        type: 'heartbeat.task.recovered',
        taskId: task.id,
        interruptedExecutionId: recovery.interruptedExecutionId,
        interruptedOwnerId: recovery.interruptedOwnerId,
        reason: recovery.reason,
        status: task.state?.status ?? 'waiting',
        progress: task.state?.progress ?? '',
        nextRunAt: task.schedule.nextRunAt,
        timestamp: recovery.recoveredAt,
      }));

      while (!options.signal?.aborted) {
        HeartbeatSchedulerService.emitRunRequestWakeEvents(options, wakeController.drain());
        await HeartbeatSchedulerService.runDueTasks({
          ...options,
          executionOwnerId,
          admissionSignal: options.signal,
          signal: options.executionSignal ?? options.signal,
        });
        if (options.signal?.aborted) {
          break;
        }
        await wakeController.wait({
          intervalMs: options.pollIntervalMs ?? DEFAULT_SCHEDULER_POLL_INTERVAL_MS,
          signal: options.signal,
          sleep: options.sleep ?? HeartbeatSchedulerService.sleep,
        });
      }
      options.onEvent?.({ type: 'heartbeat.scheduler.stopped', reason: 'aborted', timestamp: HeartbeatSchedulerService.resolveNowIso(options) });
    } catch (error) {
      if (options.signal?.aborted) {
        options.onEvent?.({ type: 'heartbeat.scheduler.stopped', reason: 'aborted', timestamp: HeartbeatSchedulerService.resolveNowIso(options) });
        return;
      }

      options.onEvent?.({ type: 'heartbeat.scheduler.stopped', reason: 'error', timestamp: HeartbeatSchedulerService.resolveNowIso(options) });
      throw error;
    } finally {
      wakeController.dispose();
    }
  }

  private static emitRunRequestWakeEvents(
    options: Pick<RunHeartbeatSchedulerOptions, 'onEvent'>,
    requests: HeartbeatTaskRunRequestSignal[],
  ): void {
    if (requests.length === 0) {
      return;
    }

    requests.forEach((request) => options.onEvent?.({
      type: 'heartbeat.task.run_requested',
      ...request,
      timestamp: request.requestedAt,
    }));
    options.onEvent?.({
      type: 'heartbeat.scheduler.awakened',
      taskIds: requests.map((request) => request.taskId),
      timestamp: requests.at(-1)?.requestedAt ?? dayjs().toISOString(),
    });
  }

  // Decides whether a task should be selected by the scheduler at the current time.
  private static isTaskDue(task: HeartbeatTask, now: Date): boolean {
    if (!task.enabled) {
      return false;
    }
    if (task.state?.status === 'running') {
      return false;
    }

    if (!task.schedule.nextRunAt) {
      return true;
    }

    const nextRunAt = dayjs(task.schedule.nextRunAt);
    return nextRunAt.isValid() && nextRunAt.isSameOrBefore(dayjs(now));
  }

  private static resolveNowIso(options: Pick<RunDueHeartbeatTasksOptions, 'now'>): string {
    return dayjs(options.now?.() ?? dayjs()).toISOString();
  }

  private static createExecutionOwnerId(): string {
    return `heartbeat-worker:${randomUUID()}`;
  }

  // Sleeps between polling cycles and resolves early when the host aborts the scheduler.
  private static sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      const finish = () => {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', finish);
        resolve();
      };
      const timeout = setTimeout(finish, ms);
      signal?.addEventListener('abort', finish, { once: true });
    });
  }
}
