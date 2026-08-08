import { EventEmitter } from 'node:events';
import { resolve } from 'node:path';
import { Mutex } from 'async-mutex';
import dayjs from 'dayjs';
import type {
  CreateHeartbeatTaskInput,
  HeartbeatTaskAdministrationService,
  ListHeartbeatRunViewsOptions,
  ReadHeartbeatTaskOptions,
  ReconcileHeartbeatTasksInput,
  ReconcileHeartbeatTasksResult,
  UpdateHeartbeatTaskInput,
} from './administration.js';
import { HeartbeatTaskControlPolicy } from './control-policy.js';
import { FileHeartbeatTaskRepository } from './repository.js';
import { HeartbeatTaskExecutionEligibilityPolicy } from './execution-eligibility.js';
import { HeartbeatTaskStateProjector } from './task-state.js';
import {
  MAX_HEARTBEAT_HANDLER_OUTCOME_SUMMARY_LENGTH,
  MAX_HEARTBEAT_HANDLER_RETRY_MS,
} from './types.js';
import type {
  FileHeartbeatTaskRepositoryOptions,
  HeartbeatTask,
  HeartbeatTaskExecution,
  HeartbeatTaskRunRecord,
  HeartbeatTaskRunRecordEntry,
  HeartbeatTaskRunRequestResult,
  HeartbeatTaskRunRequestSignal,
  HeartbeatTargetedTaskStore,
} from './types.js';
import { HeartbeatTaskViewProjector } from '../views/projector.js';
import type { HeartbeatRunView, HeartbeatTaskView } from '../views/types.js';

export type FileHeartbeatTaskServiceOptions =
  | { stateRoot: string }
  | { workspaceRoot: string; stateDir?: string }
  | FileHeartbeatTaskRepositoryOptions;

export type {
  CreateHeartbeatTaskInput,
  ReconcileHeartbeatTasksInput,
  ReconcileHeartbeatTasksResult,
  UpdateHeartbeatTaskInput,
} from './administration.js';

/**
 * Heartbeat task service.
 *
 * This is the persistence boundary for durable heartbeat tasks, checkpoints,
 * run records, and operator-facing task/run projections. Hosts should call this
 * service, not the file repository.
 */
export class FileHeartbeatTaskService implements HeartbeatTargetedTaskStore, HeartbeatTaskAdministrationService {
  private static readonly mutationMutexes = new Map<string, Mutex>();
  private static readonly activeExecutions = new Set<string>();
  private static readonly runRequestEventBuses = new Map<string, EventEmitter>();

  private readonly heartbeatRoot: string;
  private readonly mutationMutex: Mutex;
  private readonly repository: FileHeartbeatTaskRepository;
  private readonly runRequestEventBus: EventEmitter;

  constructor(options: FileHeartbeatTaskServiceOptions) {
    this.heartbeatRoot = FileHeartbeatTaskService.resolveHeartbeatRoot(options);
    this.mutationMutex = FileHeartbeatTaskService.resolveMutationMutex(this.heartbeatRoot);
    this.runRequestEventBus = FileHeartbeatTaskService.resolveRunRequestEventBus(this.heartbeatRoot);
    this.repository = new FileHeartbeatTaskRepository({
      dir: this.heartbeatRoot,
    });
  }

  async listTasks() {
    return await this.repository.listTasks();
  }

  /** Resolves exactly one task for request-driven workers without scanning the task catalog. */
  async loadTask(taskId: string) {
    return await this.repository.loadTask(taskId);
  }

  async saveTask(task: HeartbeatTask) {
    await this.mutationMutex.runExclusive(async () => await this.repository.saveTask(task));
  }

  async loadCheckpoint(task: HeartbeatTask) {
    return await this.repository.loadCheckpoint(task);
  }

  async saveCheckpoint(task: HeartbeatTask, checkpoint: Parameters<HeartbeatTargetedTaskStore['saveCheckpoint']>[1]) {
    await this.mutationMutex.runExclusive(async () => await this.repository.saveCheckpoint(task, checkpoint));
  }

  /**
   * Persists level-triggered intent for one prompt run and notifies schedulers
   * sharing this file-backed state root. The durable task record remains the
   * recovery source of truth across process boundaries.
   */
  async requestTaskRun(
    taskId: string,
    options: Parameters<HeartbeatTargetedTaskStore['requestTaskRun']>[1] = {},
  ): Promise<HeartbeatTaskRunRequestResult> {
    const result = await this.mutationMutex.runExclusive(async () => {
      const task = await this.findTask(taskId);
      if (!task) {
        throw new Error(`Heartbeat task not found: ${taskId}`);
      }
      const projection = HeartbeatTaskControlPolicy.requestTaskRun({
        task,
        options,
        now: dayjs().toDate(),
      });
      await this.repository.saveTask(projection.task);
      return projection;
    });

    this.publishRunRequest(FileHeartbeatTaskService.toRunRequestSignal(result));
    return result;
  }

  subscribeToRunRequests(listener: (request: HeartbeatTaskRunRequestSignal) => void): () => void {
    this.runRequestEventBus.on('run-requested', listener);
    return () => this.runRequestEventBus.off('run-requested', listener);
  }

  private publishRunRequest(request: HeartbeatTaskRunRequestSignal): void {
    this.runRequestEventBus.listeners('run-requested').forEach((listener) => {
      try {
        (listener as (event: HeartbeatTaskRunRequestSignal) => void)(request);
      } catch {
        // A wake-up subscriber cannot roll back or invalidate durable intent.
      }
    });
  }

  async saveRunRecord(record: Parameters<NonNullable<HeartbeatTargetedTaskStore['saveRunRecord']>>[0]) {
    await this.mutationMutex.runExclusive(async () => await this.repository.saveRunRecord(record));
  }

  /**
   * Atomically claims a non-running task for one execution attempt.
   *
   * The file adapter serializes claims within one Node.js process. Deployments
   * with multiple processes or replicas must provide a remote store whose
   * implementation uses database compare-and-swap or leases.
   */
  async claimTaskExecution(input: Parameters<HeartbeatTargetedTaskStore['claimTaskExecution']>[0]) {
    return await this.mutationMutex.runExclusive(async () => {
      const task = await this.findTask(input.taskId);
      if (!task) {
        return { status: 'not-found' } as const;
      }
      if (!task.enabled) {
        return { status: 'disabled' } as const;
      }
      if (task.state?.status === 'running') {
        return { status: 'busy' } as const;
      }
      if (input.claimMode === 'due') {
        const eligibility = HeartbeatTaskExecutionEligibilityPolicy.evaluate(task, input.claimedAt);
        if (!eligibility.eligible) {
          if (eligibility.reason === 'not-due') {
            return { status: 'not-due', task } as const;
          }
          return { status: eligibility.reason } as const;
        }
      }

      const runningTask = HeartbeatTaskStateProjector.markRunning({
        task,
        now: input.claimedAt,
        loadedCheckpoint: input.loadedCheckpoint,
        execution: input.execution,
      });
      await this.repository.saveTask(runningTask);
      FileHeartbeatTaskService.activeExecutions.add(this.executionKey(input.execution));
      return { status: 'claimed', task: runningTask } as const;
    });
  }

  /**
   * Persists a successful attempt only while its execution fencing token still
   * owns the task. A recovered retry therefore cannot be overwritten by a late
   * result from the interrupted execution.
   */
  async completeTaskExecution(input: Parameters<HeartbeatTargetedTaskStore['completeTaskExecution']>[0]) {
    return await this.mutationMutex.runExclusive(async () => {
      const currentTask = await this.findTask(input.taskId);
      if (!currentTask || !FileHeartbeatTaskService.executionMatches(currentTask, input.execution)) {
        FileHeartbeatTaskService.activeExecutions.delete(this.executionKey(input.execution));
        return { status: 'claim-lost' } as const;
      }
      if (input.signal?.aborted) {
        return { status: 'cancelled' } as const;
      }

      const currentExecution = currentTask.state?.execution ?? input.execution;
      const nextTask = HeartbeatTaskStateProjector.afterResult({
        task: currentTask,
        execution: currentExecution,
        result: input.result,
        now: input.completedAt,
        loadedCheckpoint: input.loadedCheckpoint,
      });

      const record: HeartbeatTaskRunRecord = {
        task: nextTask,
        result: input.result,
        loadedCheckpoint: input.loadedCheckpoint,
        outcome:
          nextTask.state?.lastExecution?.kind === 'agent'
          && nextTask.state.lastExecution.executionId === input.execution.executionId ?
            nextTask.state.lastExecution
          : {
              kind: 'agent',
              executionId: input.execution.executionId,
              summary: input.result.summary,
              finishedAt: input.result.state.finishedAt,
              runRequestGeneration: currentExecution.runRequestGeneration,
            },
      };
      await this.repository.saveCheckpoint(nextTask, input.checkpoint);
      await this.repository.saveTask(nextTask);
      await this.repository.saveRunRecord(record);
      FileHeartbeatTaskService.activeExecutions.delete(this.executionKey(input.execution));
      return { status: 'saved', task: nextTask, record } as const;
    });
  }

  /** Persists a failed attempt only while its execution fencing token is current. */
  async failTaskExecution(input: Parameters<HeartbeatTargetedTaskStore['failTaskExecution']>[0]) {
    return await this.mutationMutex.runExclusive(async () => {
      const currentTask = await this.findTask(input.taskId);
      if (!currentTask || !FileHeartbeatTaskService.executionMatches(currentTask, input.execution)) {
        FileHeartbeatTaskService.activeExecutions.delete(this.executionKey(input.execution));
        return { status: 'claim-lost' } as const;
      }
      if (input.signal?.aborted) {
        return { status: 'cancelled' } as const;
      }

      const nextTask = HeartbeatTaskStateProjector.afterFailure({
        task: currentTask,
        execution: currentTask.state?.execution ?? input.execution,
        error: input.error,
        now: input.failedAt,
        retryMs: input.retryMs,
      });
      await this.repository.saveTask(nextTask);
      FileHeartbeatTaskService.activeExecutions.delete(this.executionKey(input.execution));
      return { status: 'saved', task: nextTask } as const;
    });
  }

  /** Persists a claim-fenced non-agent outcome without creating or replacing a checkpoint. */
  async recordTaskExecutionOutcome(input: Parameters<HeartbeatTargetedTaskStore['recordTaskExecutionOutcome']>[0]) {
    return await this.mutationMutex.runExclusive(async () => {
      const currentTask = await this.findTask(input.taskId);
      if (!currentTask || !FileHeartbeatTaskService.executionMatches(currentTask, input.execution)) {
        FileHeartbeatTaskService.activeExecutions.delete(this.executionKey(input.execution));
        return { status: 'claim-lost' } as const;
      }
      if (input.signal?.aborted) {
        return { status: 'cancelled' } as const;
      }

      const execution = currentTask.state?.execution ?? input.execution;
      const summary = input.kind === 'retry' || input.kind === 'blocked' ?
        FileHeartbeatTaskService.normalizeHandlerOutcomeSummary(input.summary)
      : input.summary;
      const projectors = {
        skipped: () => HeartbeatTaskStateProjector.afterSkip({
          task: currentTask,
          execution,
          summary,
          now: input.finishedAt,
        }),
        retry: () => HeartbeatTaskStateProjector.afterHandlerRetry({
          task: currentTask,
          execution,
          summary,
          agentRunId: FileHeartbeatTaskService.requireOutcomeAgentRunId(input),
          retryMs: FileHeartbeatTaskService.requireOutcomeRetryMs(input),
          now: input.finishedAt,
        }),
        blocked: () => HeartbeatTaskStateProjector.afterHandlerBlock({
          task: currentTask,
          execution,
          summary,
          agentRunId: FileHeartbeatTaskService.requireOutcomeAgentRunId(input),
          now: input.finishedAt,
        }),
        cancelled: () => HeartbeatTaskStateProjector.afterCancellation({
          task: currentTask,
          execution,
          summary,
          reason: input.reason,
          now: input.finishedAt,
        }),
      } satisfies Record<typeof input.kind, () => HeartbeatTask>;
      const nextTask = projectors[input.kind]();
      const outcome = nextTask.state?.lastExecution;
      if (!outcome || outcome.kind !== input.kind) {
        throw new Error(`Heartbeat task ${input.taskId} did not project a ${input.kind} execution outcome.`);
      }

      const record: HeartbeatTaskRunRecord = {
        task: nextTask,
        outcome,
      };
      await this.repository.saveTask(nextTask);
      await this.repository.saveRunRecord(record);
      FileHeartbeatTaskService.activeExecutions.delete(this.executionKey(input.execution));
      return { status: 'saved', task: nextTask, record } as const;
    });
  }

  /**
   * Makes executions owned by a prior single-host process generation retryable.
   * Active executions claimed in this process are never recovered. Calling the
   * method repeatedly is idempotent because recovered tasks are no longer
   * `running` and no longer carry a current execution.
   */
  async recoverInterruptedTasks(input: Parameters<HeartbeatTargetedTaskStore['recoverInterruptedTasks']>[0]) {
    return await this.mutationMutex.runExclusive(async () => {
      const tasks = await this.repository.listTasks();
      const recoverableTasks = tasks.filter((task) => this.isRecoverableTask(task, input.ownerId));

      return await Promise.all(recoverableTasks.map(async (task) => {
        const interruptedTask = task.state?.execution ? task : FileHeartbeatTaskService.withLegacyExecution(task);
        const recovered = HeartbeatTaskStateProjector.afterRecovery({
          task: interruptedTask,
          now: input.recoveredAt,
          reason: input.reason,
        });
        await this.repository.saveTask(recovered.task);
        return recovered;
      }));
    });
  }

  async listRunRecords(options?: Parameters<NonNullable<HeartbeatTargetedTaskStore['listRunRecords']>>[0]) {
    return await this.repository.listRunRecords?.(options) ?? [];
  }

  async loadRunRecord(id: string) {
    return await this.repository.loadRunRecord?.(id);
  }

  async listTaskViews() {
    return HeartbeatTaskViewProjector.projectTasks(await this.listTasks());
  }

  async listRunViews(options: ListHeartbeatRunViewsOptions = {}) {
    const runs = await this.listRunRecords(options);
    return runs.map((run) => HeartbeatTaskViewProjector.projectRun(run));
  }

  async createTask(input: CreateHeartbeatTaskInput) {
    return await this.mutationMutex.runExclusive(async () => {
      const tasks = await this.repository.listTasks();
      const task = HeartbeatTaskControlPolicy.createTask({
        input,
        existingTasks: tasks,
        now: dayjs().toDate(),
      });

      await this.repository.saveTask(task);
      return HeartbeatTaskViewProjector.projectTask(task);
    });
  }

  /**
   * Reconciles membership for one host-owned task namespace under the same
   * mutation boundary used by scheduler claims and task control operations.
   *
   * It only creates missing desired tasks and deletes obsolete non-running
   * tasks. Existing tasks are left intact so reconciliation cannot erase an
   * operator change, run-request generation, checkpoint association, or live
   * execution fencing token. Call the explicit task update APIs when a host
   * needs to change an existing task's configuration.
   */
  async reconcileTasks(input: ReconcileHeartbeatTasksInput): Promise<ReconcileHeartbeatTasksResult> {
    return await this.mutationMutex.runExclusive(async () => {
      const currentTasks = await this.repository.listTasks();
      const reconciliation = HeartbeatTaskControlPolicy.reconcileTasks({ currentTasks, input });

      await Promise.all(reconciliation.created.map(async (task) => await this.repository.saveTask(task)));
      await Promise.all(reconciliation.deleted.map(async (task) => await this.repository.deleteTask(task)));

      return reconciliation;
    });
  }

  async updateTask(taskId: string, input: UpdateHeartbeatTaskInput) {
    const nextTask = await this.updateStoredTask(taskId, (task) => HeartbeatTaskControlPolicy.updateTask({
      task,
      input,
      now: dayjs().toDate(),
    }));
    return HeartbeatTaskViewProjector.projectTask(nextTask);
  }

  async deleteTask(taskId: string) {
    const task = await this.mutationMutex.runExclusive(async () => {
      const currentTask = await this.findTask(taskId);
      if (!currentTask) {
        throw new Error(`Heartbeat task not found: ${taskId}`);
      }
      HeartbeatTaskControlPolicy.assertTaskCanBeDeleted(currentTask);

      await this.repository.deleteTask(currentTask);
      return currentTask;
    });
    return HeartbeatTaskViewProjector.projectTask(task);
  }

  async resumeTask(taskId: string) {
    const nextTask = await this.updateStoredTask(taskId, (task) => HeartbeatTaskControlPolicy.resumeTask({
      task,
      now: dayjs().toDate(),
    }));
    return HeartbeatTaskViewProjector.projectTask(nextTask);
  }

  async readTask(taskId: string, options: ReadHeartbeatTaskOptions = {}) {
    const task = await this.requireTask(taskId);
    const runs = await this.listRunViews({
      taskId,
      limit: options.runLimit ?? 50,
    });

    return {
      task: HeartbeatTaskViewProjector.projectTask(task),
      runs,
    };
  }

  async readRun(taskId: string, runId: string) {
    await this.requireTask(taskId);
    const run =
      runId === 'latest' ?
        (await this.listRunRecords({ taskId, limit: 1 }))[0]
      : await this.loadRunRecord(runId);
    if (!run || run.taskId !== taskId) {
      return undefined;
    }
    return HeartbeatTaskViewProjector.projectRun(run);
  }

  async setTaskEnabled(taskId: string, enabled: boolean) {
    const nextTask = await this.updateStoredTask(taskId, (task) => HeartbeatTaskControlPolicy.setTaskEnabled({
      task,
      enabled,
      now: dayjs().toDate(),
    }));
    return HeartbeatTaskViewProjector.projectTask(nextTask);
  }

  async triggerTaskRun(taskId: string) {
    const result = await this.requestTaskRun(taskId, { reason: 'manual-trigger' });
    return HeartbeatTaskViewProjector.projectTask(result.task);
  }

  async requireTask(taskId: string): Promise<HeartbeatTask> {
    const task = await this.findTask(taskId);
    if (!task) {
      throw new Error(`Heartbeat task not found: ${taskId}`);
    }
    return task;
  }

  projectTaskView(task: HeartbeatTask): HeartbeatTaskView {
    return HeartbeatTaskViewProjector.projectTask(task);
  }

  projectRunView(run: HeartbeatTaskRunRecordEntry): HeartbeatRunView {
    return HeartbeatTaskViewProjector.projectRun(run);
  }

  static projectTaskView(task: HeartbeatTask): HeartbeatTaskView {
    return HeartbeatTaskViewProjector.projectTask(task);
  }

  static projectRunView(run: HeartbeatTaskRunRecordEntry): HeartbeatRunView {
    return HeartbeatTaskViewProjector.projectRun(run);
  }

  static projectRunRecordView(record: HeartbeatTaskRunRecord): HeartbeatRunView {
    return HeartbeatTaskViewProjector.projectRunRecord(record);
  }

  private static resolveHeartbeatRoot(options: FileHeartbeatTaskServiceOptions): string {
    if ('dir' in options) {
      return resolve(options.dir);
    }

    if ('stateRoot' in options) {
      return resolve(options.stateRoot, 'heartbeat');
    }

    return resolve(options.workspaceRoot, options.stateDir ?? '.heddle', 'heartbeat');
  }

  private static requireOutcomeAgentRunId(input: {
    taskId: string;
    kind: string;
    agentRunId?: string;
  }): string {
    if (!input.agentRunId) {
      throw new Error(`Heartbeat task ${input.taskId} ${input.kind} outcome requires its nested agent run id.`);
    }
    return input.agentRunId;
  }

  private static requireOutcomeRetryMs(input: {
    taskId: string;
    retryMs?: number;
  }): number {
    if (input.retryMs === undefined) {
      throw new Error(`Heartbeat task ${input.taskId} retry outcome requires a delay.`);
    }
    if (!Number.isSafeInteger(input.retryMs) || input.retryMs < 1 || input.retryMs > MAX_HEARTBEAT_HANDLER_RETRY_MS) {
      throw new Error(`Heartbeat task ${input.taskId} retry delay must be a positive integer no greater than ${MAX_HEARTBEAT_HANDLER_RETRY_MS} milliseconds.`);
    }
    return input.retryMs;
  }

  private static normalizeHandlerOutcomeSummary(summary: string): string {
    const normalized = summary.trim();
    if (!normalized || normalized.length > MAX_HEARTBEAT_HANDLER_OUTCOME_SUMMARY_LENGTH) {
      throw new Error(`Heartbeat retry and blocked summaries must be non-empty and at most ${MAX_HEARTBEAT_HANDLER_OUTCOME_SUMMARY_LENGTH} characters.`);
    }
    return normalized;
  }

  private static toRunRequestSignal(
    result: HeartbeatTaskRunRequestResult,
  ): HeartbeatTaskRunRequestSignal {
    return {
      taskId: result.taskId,
      generation: result.generation,
      disposition: result.disposition,
      requestedAt: result.requestedAt,
      reason: result.reason,
    };
  }

  private async findTask(taskId: string): Promise<HeartbeatTask | undefined> {
    return await this.repository.loadTask(taskId);
  }

  /** Serializes one task read-transform-write transition for the file adapter. */
  private async updateStoredTask(
    taskId: string,
    update: (task: HeartbeatTask) => HeartbeatTask,
  ): Promise<HeartbeatTask> {
    return await this.mutationMutex.runExclusive(async () => {
      const task = await this.findTask(taskId);
      if (!task) {
        throw new Error(`Heartbeat task not found: ${taskId}`);
      }

      const nextTask = update(task);
      await this.repository.saveTask(nextTask);
      return nextTask;
    });
  }

  private executionKey(execution: HeartbeatTaskExecution): string {
    return `${this.heartbeatRoot}:${execution.executionId}`;
  }

  private isRecoverableTask(task: HeartbeatTask, currentOwnerId: string): boolean {
    if (task.state?.status !== 'running') {
      return false;
    }

    const execution = task.state.execution;
    return !execution || (
      execution.ownerId !== currentOwnerId
      && !FileHeartbeatTaskService.activeExecutions.has(this.executionKey(execution))
    );
  }

  private static executionMatches(task: HeartbeatTask | undefined, execution: HeartbeatTaskExecution): boolean {
    return task?.state?.status === 'running'
      && task.state.execution?.executionId === execution.executionId
      && task.state.execution.ownerId === execution.ownerId;
  }

  private static resolveMutationMutex(heartbeatRoot: string): Mutex {
    const existing = FileHeartbeatTaskService.mutationMutexes.get(heartbeatRoot);
    if (existing) {
      return existing;
    }

    const mutex = new Mutex();
    FileHeartbeatTaskService.mutationMutexes.set(heartbeatRoot, mutex);
    return mutex;
  }

  private static resolveRunRequestEventBus(heartbeatRoot: string): EventEmitter {
    const existing = FileHeartbeatTaskService.runRequestEventBuses.get(heartbeatRoot);
    if (existing) {
      return existing;
    }

    const eventBus = new EventEmitter();
    FileHeartbeatTaskService.runRequestEventBuses.set(heartbeatRoot, eventBus);
    return eventBus;
  }

  private static withLegacyExecution(task: HeartbeatTask): HeartbeatTask {
    const claimedAt = task.state?.updatedAt ?? task.state?.runAt ?? dayjs(0).toISOString();
    return {
      ...task,
      state: {
        ...task.state,
        execution: {
          executionId: `legacy:${task.id}:${claimedAt}`,
          ownerId: 'legacy-file-host',
          claimedAt,
        },
      },
    };
  }

}
