/**
 * Process-local task lifecycle for one background scheduler handle.
 *
 * Durable ownership and fencing stay in `HeartbeatTaskStore`. This registry
 * owns only admission invalidation, delivery of a task-scoped abort signal to
 * executions started by this handle, and awaiting their outer settlement.
 */
import {
  type HeartbeatTaskRunRecord,
  type HeartbeatTaskStore,
} from '../tasks/index.js';
import { HeartbeatTaskCancellationPolicy } from './cancellation-policy.js';
import type {
  CancelHeartbeatTaskOptions,
  HeartbeatTaskCancellationResult,
} from './types.js';

type HeartbeatTaskSettlement = {
  record?: HeartbeatTaskRunRecord;
  failed: boolean;
};

type ActiveHeartbeatTask = {
  controller: AbortController;
  settlement: Promise<HeartbeatTaskSettlement | undefined>;
};

export class HeartbeatSchedulerTaskLifecycle {
  private readonly activeTasks = new Map<string, ActiveHeartbeatTask>();
  private readonly admissionGenerations = new Map<string, number>();
  private readonly cancellations = new Map<string, Promise<HeartbeatTaskCancellationResult>>();

  constructor(private readonly store: HeartbeatTaskStore) {}

  /** Captures the current admission generation when a due task enters the bounded queue. */
  createAdmission(taskId: string): number {
    return this.admissionGenerations.get(taskId) ?? 0;
  }

  /**
   * Runs one admitted task with a task-scoped signal. A cancellation invalidates
   * queued admissions before they can claim and aborts only this active entry.
   */
  runTask(
    taskId: string,
    admissionGeneration: number,
    run: (signal: AbortSignal) => Promise<HeartbeatTaskSettlement | undefined>,
  ): Promise<HeartbeatTaskSettlement | undefined> {
    if (admissionGeneration !== (this.admissionGenerations.get(taskId) ?? 0)) {
      return Promise.resolve(undefined);
    }
    if (this.activeTasks.has(taskId)) {
      return Promise.resolve(undefined);
    }

    const controller = new AbortController();
    let resolveSettlement!: (value: HeartbeatTaskSettlement | undefined) => void;
    let rejectSettlement!: (reason?: unknown) => void;
    const settlement = new Promise<HeartbeatTaskSettlement | undefined>((resolve, reject) => {
      resolveSettlement = resolve;
      rejectSettlement = reject;
    });
    const activeTask = { controller, settlement };
    this.activeTasks.set(taskId, activeTask);
    void this.settleTask({
      taskId,
      activeTask,
      run,
      resolve: resolveSettlement,
      reject: rejectSettlement,
    });
    return settlement;
  }

  cancelTask(taskId: string, options: CancelHeartbeatTaskOptions): Promise<HeartbeatTaskCancellationResult> {
    const activeCancellation = this.cancellations.get(taskId);
    if (activeCancellation) {
      return activeCancellation;
    }

    let reason: string;
    try {
      reason = HeartbeatTaskCancellationPolicy.normalizeReason(options.reason);
    } catch (error) {
      return Promise.reject(error);
    }

    const cancellation = this.cancelTaskOnce(taskId, reason);
    this.cancellations.set(taskId, cancellation);
    void cancellation.finally(() => {
      if (this.cancellations.get(taskId) === cancellation) {
        this.cancellations.delete(taskId);
      }
    }).catch(() => undefined);
    return cancellation;
  }

  private async settleTask(args: {
    taskId: string;
    activeTask: ActiveHeartbeatTask;
    run: (signal: AbortSignal) => Promise<HeartbeatTaskSettlement | undefined>;
    resolve: (value: HeartbeatTaskSettlement | undefined) => void;
    reject: (reason?: unknown) => void;
  }): Promise<void> {
    try {
      args.resolve(await args.run(args.activeTask.controller.signal));
    } catch (error) {
      args.reject(error);
    } finally {
      if (this.activeTasks.get(args.taskId) === args.activeTask) {
        this.activeTasks.delete(args.taskId);
      }
    }
  }

  private async cancelTaskOnce(taskId: string, reason: string): Promise<HeartbeatTaskCancellationResult> {
    this.invalidateAdmissions(taskId);
    const activeTask = this.activeTasks.get(taskId);
    if (!activeTask) {
      return await this.classifyInactiveTask(taskId, reason);
    }

    activeTask.controller.abort(HeartbeatTaskCancellationPolicy.createSignal(reason));
    const settlement = await activeTask.settlement;
    const result = HeartbeatSchedulerTaskLifecycle.cancellationResult({
      taskId,
      reason,
      settlement,
    });
    return result.disposition === 'not-running' ?
      await this.classifyInactiveTask(taskId, reason)
    : result;
  }

  private invalidateAdmissions(taskId: string): void {
    const generation = (this.admissionGenerations.get(taskId) ?? 0) + 1;
    if (!Number.isSafeInteger(generation)) {
      throw new Error(`Heartbeat task ${taskId} admission generation is exhausted.`);
    }
    this.admissionGenerations.set(taskId, generation);
  }

  private async classifyInactiveTask(taskId: string, reason: string): Promise<HeartbeatTaskCancellationResult> {
    const task = (await this.store.listTasks()).find((candidate) => candidate.id === taskId);
    const disposition = HeartbeatTaskCancellationPolicy.inactiveDisposition(task);
    return { taskId, disposition, reason };
  }

  private static cancellationResult(args: {
    taskId: string;
    reason: string;
    settlement: HeartbeatTaskSettlement | undefined;
  }): HeartbeatTaskCancellationResult {
    const record = args.settlement?.record;
    if (record?.outcome?.kind === 'cancelled') {
      return {
        taskId: args.taskId,
        disposition: 'cancelled',
        reason: args.reason,
        executionId: record.outcome.executionId,
        record,
      };
    }
    if (record || args.settlement?.failed) {
      return {
        taskId: args.taskId,
        disposition: 'completion-won',
        reason: args.reason,
        executionId: record?.outcome?.executionId,
        record,
      };
    }
    return {
      taskId: args.taskId,
      disposition: 'not-running',
      reason: args.reason,
    };
  }

}
