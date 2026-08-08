import { EventEmitter } from 'node:events';
import { resolve } from 'node:path';
import { Mutex } from 'async-mutex';
import dayjs from 'dayjs';
import omit from 'lodash/omit.js';
import orderBy from 'lodash/orderBy.js';
import { FileHeartbeatTaskRepository } from './repository.js';
import { HeartbeatTaskStateProjector } from './task-state.js';
import { MAX_HEARTBEAT_RUN_REQUEST_REASON_LENGTH } from './types.js';
import type {
  FileHeartbeatTaskRepositoryOptions,
  HeartbeatTask,
  HeartbeatTaskExecution,
  HeartbeatTaskExecutionOutcome,
  HeartbeatTaskState,
  HeartbeatTaskRunRecord,
  HeartbeatTaskRunRecordEntry,
  HeartbeatTaskRunRequestResult,
  HeartbeatTaskRunRequestSignal,
  HeartbeatTaskStore,
} from './types.js';
import type { HeartbeatRunView, HeartbeatTaskResultView, HeartbeatTaskView } from '../views/index.js';
import type { AgentHeartbeatResult } from '../agent/index.js';

export type FileHeartbeatTaskServiceOptions =
  | { stateRoot: string }
  | { workspaceRoot: string; stateDir?: string }
  | FileHeartbeatTaskRepositoryOptions;

export type CreateHeartbeatTaskInput = {
  workspaceId?: string;
  id?: string;
  name?: string;
  task: string;
  enabled?: boolean;
  continuationMode?: HeartbeatTask['continuationMode'];
  intervalMs?: number;
  defer?: boolean;
  model?: string;
  maxSteps?: number;
  workspaceRoot?: string;
  stateDir?: string;
  searchIgnoreDirs?: string[];
  systemContext?: string;
};

export type UpdateHeartbeatTaskInput = {
  name?: string;
  task?: string;
  enabled?: boolean;
  continuationMode?: HeartbeatTask['continuationMode'];
  intervalMs?: number;
  model?: string | null;
  maxSteps?: number | null;
  searchIgnoreDirs?: string[];
  systemContext?: string;
};

export type ReconcileHeartbeatTasksInput = {
  /** Prefix that limits this reconciliation to tasks owned by one host concern. */
  namespace: string;
  /** Desired members of the namespace. Existing members retain their stored configuration and state. */
  desired: readonly HeartbeatTask[];
};

export type ReconcileHeartbeatTasksResult = {
  created: HeartbeatTask[];
  deleted: HeartbeatTask[];
  /** Running tasks retained without rewriting their execution claim or state. */
  preservedRunning: HeartbeatTask[];
};

/**
 * Heartbeat task service.
 *
 * This is the persistence boundary for durable heartbeat tasks, checkpoints,
 * run records, and operator-facing task/run projections. Hosts should call this
 * service, not the file repository.
 */
export class FileHeartbeatTaskService implements HeartbeatTaskStore {
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

  async saveTask(task: HeartbeatTask) {
    await this.mutationMutex.runExclusive(async () => await this.repository.saveTask(task));
  }

  async loadCheckpoint(task: HeartbeatTask) {
    return await this.repository.loadCheckpoint(task);
  }

  async saveCheckpoint(task: HeartbeatTask, checkpoint: Parameters<HeartbeatTaskStore['saveCheckpoint']>[1]) {
    await this.mutationMutex.runExclusive(async () => await this.repository.saveCheckpoint(task, checkpoint));
  }

  /**
   * Persists level-triggered intent for one prompt run and notifies schedulers
   * sharing this file-backed state root. The durable task record remains the
   * recovery source of truth across process boundaries.
   */
  async requestTaskRun(
    taskId: string,
    options: Parameters<HeartbeatTaskStore['requestTaskRun']>[1] = {},
  ): Promise<HeartbeatTaskRunRequestResult> {
    const reason = FileHeartbeatTaskService.normalizeRunRequestReason(options.reason);
    const requestedAt = options.requestedAt ?? dayjs().toDate();
    if (!dayjs(requestedAt).isValid()) {
      throw new Error('Heartbeat run-request timestamp must be a valid date.');
    }
    const result = await this.mutationMutex.runExclusive(async () => {
      const task = await this.findTask(taskId);
      if (!task) {
        throw new Error(`Heartbeat task not found: ${taskId}`);
      }
      FileHeartbeatTaskService.assertTaskAcceptsRunRequest(task);

      const projection = HeartbeatTaskStateProjector.requestRun({
        task,
        now: requestedAt,
        reason,
      });
      await this.repository.saveTask(projection.task);
      const request = projection.task.state?.runRequest;
      if (!request) {
        throw new Error(`Heartbeat task ${taskId} did not persist its run request.`);
      }

      return {
        task: projection.task,
        taskId,
        generation: request.generation,
        disposition: projection.disposition,
        requestedAt: request.requestedAt,
        reason: request.reason,
      } as const;
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

  async saveRunRecord(record: Parameters<NonNullable<HeartbeatTaskStore['saveRunRecord']>>[0]) {
    await this.mutationMutex.runExclusive(async () => await this.repository.saveRunRecord(record));
  }

  /**
   * Atomically claims a non-running task for one execution attempt.
   *
   * The file adapter serializes claims within one Node.js process. Deployments
   * with multiple processes or replicas must provide a remote store whose
   * implementation uses database compare-and-swap or leases.
   */
  async claimTaskExecution(input: Parameters<HeartbeatTaskStore['claimTaskExecution']>[0]) {
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
  async completeTaskExecution(input: Parameters<HeartbeatTaskStore['completeTaskExecution']>[0]) {
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
  async failTaskExecution(input: Parameters<HeartbeatTaskStore['failTaskExecution']>[0]) {
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
  async recordTaskExecutionOutcome(input: Parameters<HeartbeatTaskStore['recordTaskExecutionOutcome']>[0]) {
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
      const projectors = {
        skipped: () => HeartbeatTaskStateProjector.afterSkip({
          task: currentTask,
          execution,
          summary: input.summary,
          now: input.finishedAt,
        }),
        cancelled: () => HeartbeatTaskStateProjector.afterCancellation({
          task: currentTask,
          execution,
          summary: input.summary,
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
  async recoverInterruptedTasks(input: Parameters<HeartbeatTaskStore['recoverInterruptedTasks']>[0]) {
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

  async listRunRecords(options?: Parameters<NonNullable<HeartbeatTaskStore['listRunRecords']>>[0]) {
    return await this.repository.listRunRecords?.(options) ?? [];
  }

  async loadRunRecord(id: string) {
    return await this.repository.loadRunRecord?.(id);
  }

  async listTaskViews() {
    return orderBy(
      (await this.listTasks()).map((task) => FileHeartbeatTaskService.projectTaskView(task)),
      [(task) => FileHeartbeatTaskService.taskLastRunTime(task)],
      ['desc'],
    );
  }

  async listRunViews(options: { taskId?: string; limit?: number } = {}) {
    const runs = await this.listRunRecords(options);
    return runs.map((run) => FileHeartbeatTaskService.projectRunView(run));
  }

  async createTask(input: CreateHeartbeatTaskInput) {
    return await this.mutationMutex.runExclusive(async () => {
      const tasks = await this.repository.listTasks();
      const now = dayjs();
      const id = input.id ?? FileHeartbeatTaskService.createTaskId(input.name ?? input.task, tasks.map((task) => task.id));
      if (tasks.some((task) => task.id === id)) {
        throw new Error(`Heartbeat task already exists: ${id}`);
      }

      const intervalMs = input.intervalMs ?? 60 * 60_000;
      const task: HeartbeatTask = {
        id,
        workspaceId: input.workspaceId,
        name: input.name,
        task: input.task.trim(),
        enabled: input.enabled ?? true,
        continuationMode: input.continuationMode ?? 'operator',
        schedule: {
          intervalMs,
          nextRunAt: (input.defer === false ? now.subtract(1, 'second') : now.add(intervalMs, 'millisecond')).toISOString(),
        },
        runtime: {
          model: input.model,
          maxSteps: input.maxSteps,
          workspaceRoot: input.workspaceRoot,
          stateDir: input.stateDir,
          searchIgnoreDirs: input.searchIgnoreDirs,
          systemContext: input.systemContext,
        },
        state: {
          status: input.enabled === false ? 'idle' : 'waiting',
          updatedAt: now.toISOString(),
        },
      };

      await this.repository.saveTask(task);
      return FileHeartbeatTaskService.projectTaskView(task);
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
    FileHeartbeatTaskService.assertReconciliationInput(input);

    return await this.mutationMutex.runExclusive(async () => {
      const currentTasks = await this.repository.listTasks();
      const currentById = new Map(currentTasks.map((task) => [task.id, task]));
      const desiredById = new Map(input.desired.map((task) => [task.id, task]));
      const namespaceTasks = currentTasks.filter((task) => task.id.startsWith(input.namespace));
      const created = [...desiredById.values()].filter((task) => !currentById.has(task.id));
      const obsolete = namespaceTasks.filter((task) => !desiredById.has(task.id));
      const preservedRunning = namespaceTasks.filter((task) => task.state?.status === 'running');
      const deleted = obsolete.filter((task) => task.state?.status !== 'running');

      await Promise.all(created.map(async (task) => await this.repository.saveTask(task)));
      await Promise.all(deleted.map(async (task) => await this.repository.deleteTask(task)));

      return { created, deleted, preservedRunning };
    });
  }

  async updateTask(taskId: string, input: UpdateHeartbeatTaskInput) {
    const nextTask = await this.updateStoredTask(taskId, (task) => {
      const now = dayjs();
      const intervalMs = input.intervalMs ?? task.schedule.intervalMs;
      const running = task.state?.status === 'running';
      const enabled = input.enabled ?? task.enabled;
      const pendingRunRequest = HeartbeatTaskStateProjector.hasPendingRunRequest(task);
      return {
        ...task,
        name: input.name ?? task.name,
        task: input.task?.trim() ?? task.task,
        enabled,
        continuationMode: input.continuationMode ?? task.continuationMode ?? 'operator',
        schedule: {
          ...task.schedule,
          intervalMs,
          nextRunAt:
            !enabled ? undefined
            : running || pendingRunRequest ? task.schedule.nextRunAt
            : now.add(intervalMs, 'millisecond').toISOString(),
        },
        runtime: {
          ...task.runtime,
          model: input.model === undefined ? task.runtime?.model : input.model ?? undefined,
          maxSteps: input.maxSteps === undefined ? task.runtime?.maxSteps : input.maxSteps ?? undefined,
          searchIgnoreDirs: input.searchIgnoreDirs ?? task.runtime?.searchIgnoreDirs,
          systemContext: input.systemContext ?? task.runtime?.systemContext,
        },
        state: {
          ...task.state,
          runRequest: !enabled ? FileHeartbeatTaskService.consumePendingRunRequest(task.state?.runRequest) : task.state?.runRequest,
          updatedAt: now.toISOString(),
        },
      };
    });
    return FileHeartbeatTaskService.projectTaskView(nextTask);
  }

  async deleteTask(taskId: string) {
    const task = await this.mutationMutex.runExclusive(async () => {
      const currentTask = await this.findTask(taskId);
      if (!currentTask) {
        throw new Error(`Heartbeat task not found: ${taskId}`);
      }
      if (currentTask.state?.status === 'running') {
        throw new Error(`Heartbeat task ${taskId} is running. Wait for the run to finish before deleting it.`);
      }

      await this.repository.deleteTask(currentTask);
      return currentTask;
    });
    return FileHeartbeatTaskService.projectTaskView(task);
  }

  async resumeTask(taskId: string) {
    const nextTask = await this.updateStoredTask(taskId, (task) => {
      if (task.state?.status === 'running') {
        throw new Error(`Heartbeat task ${taskId} is already running.`);
      }
      if (task.state?.resumable === false) {
        throw new Error(`Heartbeat task ${taskId} cannot be resumed.`);
      }

      const now = dayjs();
      return {
        ...task,
        enabled: true,
        schedule: {
          ...task.schedule,
          nextRunAt: now.subtract(1, 'second').toISOString(),
        },
        state: {
          ...omit(task.state, ['error']),
          status: 'waiting',
          progress: 'Heartbeat task resumed. Waiting for the next scheduler poll.',
          updatedAt: now.toISOString(),
        },
      };
    });
    return FileHeartbeatTaskService.projectTaskView(nextTask);
  }

  async readTask(taskId: string, options: { runLimit?: number } = {}) {
    const task = await this.requireTask(taskId);
    const runs = await this.listRunViews({
      taskId,
      limit: options.runLimit ?? 50,
    });

    return {
      task: FileHeartbeatTaskService.projectTaskView(task),
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
    return FileHeartbeatTaskService.projectRunView(run);
  }

  async setTaskEnabled(taskId: string, enabled: boolean) {
    const nextTask = await this.updateStoredTask(taskId, (task) => {
      const now = dayjs();
      if (enabled && task.state?.status === 'blocked') {
        throw new Error(`Heartbeat task ${taskId} is blocked. Use resume to unblock it.`);
      }

      const status = FileHeartbeatTaskService.resolveTaskEnabledStatus(task, enabled);
      const progress = FileHeartbeatTaskService.resolveTaskEnabledProgress(task, enabled);
      return {
        ...task,
        enabled,
        schedule: {
          ...task.schedule,
          nextRunAt:
            enabled ?
              task.schedule.nextRunAt ?? now.subtract(1, 'second').toISOString()
            : undefined,
        },
        state: {
          ...task.state,
          status,
          progress,
          resumable: enabled ? true : task.state?.resumable,
          runRequest: enabled ? task.state?.runRequest : FileHeartbeatTaskService.consumePendingRunRequest(task.state?.runRequest),
          updatedAt: now.toISOString(),
        },
      };
    });
    return FileHeartbeatTaskService.projectTaskView(nextTask);
  }

  async triggerTaskRun(taskId: string) {
    const result = await this.requestTaskRun(taskId, { reason: 'manual-trigger' });
    return FileHeartbeatTaskService.projectTaskView(result.task);
  }

  async requireTask(taskId: string): Promise<HeartbeatTask> {
    const task = await this.findTask(taskId);
    if (!task) {
      throw new Error(`Heartbeat task not found: ${taskId}`);
    }
    return task;
  }

  projectTaskView(task: HeartbeatTask): HeartbeatTaskView {
    return FileHeartbeatTaskService.projectTaskView(task);
  }

  projectRunView(run: HeartbeatTaskRunRecordEntry): HeartbeatRunView {
    return FileHeartbeatTaskService.projectRunView(run);
  }

  static projectTaskView(task: HeartbeatTask): HeartbeatTaskView {
    const state = FileHeartbeatTaskService.projectTaskStateView(task.state);
    return {
      ...task,
      taskId: task.id,
      state,
    };
  }

  static projectRunView(run: HeartbeatTaskRunRecordEntry): HeartbeatRunView {
    return {
      ...omit(run, ['record', 'path']),
      ...FileHeartbeatTaskService.projectRunRecordView(run.record),
    };
  }

  static projectRunRecordView(record: HeartbeatTaskRunRecord): HeartbeatRunView {
    const outcome = FileHeartbeatTaskService.resolveRecordOutcome(record);
    const runId = record.result?.state.runId;
    return {
      id: runId ?? outcome.executionId,
      taskId: record.task.id,
      executionId: outcome.executionId,
      runId,
      workspaceId: record.task.workspaceId,
      createdAt: outcome.finishedAt,
      task: FileHeartbeatTaskService.projectTaskView(record.task),
      result: record.result ?
        FileHeartbeatTaskService.projectResultView(record.result)
      : FileHeartbeatTaskService.projectOutcomeView(outcome),
      loadedCheckpoint: record.loadedCheckpoint,
    };
  }

  private static projectTaskStateView(state: HeartbeatTaskState | undefined): HeartbeatTaskView['state'] {
    const result =
      state?.lastExecution && state.lastExecution.kind !== 'agent' ?
        FileHeartbeatTaskService.projectOutcomeView(state.lastExecution)
      : state?.result ? FileHeartbeatTaskService.projectResultView(state.result)
      : state?.lastExecution ? FileHeartbeatTaskService.projectOutcomeView(state.lastExecution)
      : undefined;
    return {
      ...omit(state ?? {}, ['result', 'runRequest']),
      status: state?.status ?? 'idle',
      result,
      runRequest: state?.runRequest ? {
        ...state.runRequest,
        pending: state.runRequest.generation > state.runRequest.claimedGeneration,
      } : undefined,
    };
  }

  private static projectResultView(result: AgentHeartbeatResult): HeartbeatTaskResultView {
    return {
      kind: 'agent',
      decision: result.decision,
      summary: result.summary,
      outcome: result.state.outcome,
      usage: result.state.usage,
    };
  }

  private static projectOutcomeView(outcome: HeartbeatTaskExecutionOutcome): HeartbeatTaskResultView {
    return {
      kind: outcome.kind,
      summary: outcome.summary,
      outcome: outcome.kind,
    };
  }

  private static resolveRecordOutcome(record: HeartbeatTaskRunRecord): HeartbeatTaskExecutionOutcome {
    if (record.outcome) {
      return record.outcome;
    }
    if (!record.result) {
      throw new Error(`Heartbeat record for task ${record.task.id} has no execution outcome.`);
    }

    return {
      kind: 'agent',
      executionId: record.result.state.runId,
      summary: record.result.summary,
      finishedAt: record.result.state.finishedAt,
    };
  }

  private static taskLastRunTime(task: HeartbeatTaskView): number {
    const runAt = task.state.runAt ? dayjs(task.state.runAt) : undefined;
    return runAt?.isValid() ? runAt.valueOf() : 0;
  }

  private static resolveTaskEnabledStatus(task: HeartbeatTask, enabled: boolean): NonNullable<HeartbeatTaskState['status']> {
    if (task.state?.status === 'running') {
      return 'running';
    }
    if (!enabled && task.state?.status === 'blocked') {
      return 'blocked';
    }
    return enabled ? 'waiting' : 'idle';
  }

  private static resolveTaskEnabledProgress(task: HeartbeatTask, enabled: boolean): string | undefined {
    if (task.state?.status === 'running' || task.state?.status === 'blocked') {
      return task.state.progress;
    }
    return enabled ?
      'Heartbeat task enabled. Waiting for the next scheduled run.'
    : 'Heartbeat task paused by operator.';
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

  private static assertTaskAcceptsRunRequest(task: HeartbeatTask): void {
    if (task.state?.status === 'blocked') {
      throw new Error(`Heartbeat task ${task.id} is blocked. Resume it before requesting a run.`);
    }
    if (task.state?.status === 'complete') {
      throw new Error(`Heartbeat task ${task.id} is complete. Resume it before requesting a run.`);
    }
    if (!task.enabled) {
      throw new Error(`Heartbeat task ${task.id} is disabled. Enable it before requesting a run.`);
    }
  }

  private static normalizeRunRequestReason(reason: string | undefined): string | undefined {
    if (reason === undefined) {
      return undefined;
    }

    const normalized = reason.trim();
    if (!normalized) {
      throw new Error('Heartbeat run-request reason cannot be empty.');
    }
    if (normalized.length > MAX_HEARTBEAT_RUN_REQUEST_REASON_LENGTH) {
      throw new Error(`Heartbeat run-request reason must be at most ${MAX_HEARTBEAT_RUN_REQUEST_REASON_LENGTH} characters.`);
    }
    return normalized;
  }

  private static assertReconciliationInput(input: ReconcileHeartbeatTasksInput): void {
    if (!input.namespace) {
      throw new Error('Heartbeat reconciliation namespace cannot be empty.');
    }

    const desiredIds = input.desired.map((task) => task.id);
    if (new Set(desiredIds).size !== desiredIds.length) {
      throw new Error(`Heartbeat reconciliation namespace ${input.namespace} contains duplicate task IDs.`);
    }
    if (desiredIds.some((taskId) => !taskId.startsWith(input.namespace))) {
      throw new Error(`Heartbeat reconciliation desired task IDs must start with namespace ${input.namespace}.`);
    }
  }

  private static consumePendingRunRequest(
    runRequest: HeartbeatTaskState['runRequest'],
  ): HeartbeatTaskState['runRequest'] {
    return runRequest ? {
      ...runRequest,
      claimedGeneration: runRequest.generation,
    } : undefined;
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
    return (await this.repository.listTasks()).find((candidate) => candidate.id === taskId);
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

  private static createTaskId(value: string, existingIds: string[]): string {
    const base = value
      .toLowerCase()
      .replace(/[`'"]/g, '')
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64)
      .replace(/-+$/g, '') || 'heartbeat-task';
    if (!existingIds.includes(base)) {
      return base;
    }

    for (let index = 2; index < 1_000; index++) {
      const candidate = `${base}-${index}`;
      if (!existingIds.includes(candidate)) {
        return candidate;
      }
    }

    throw new Error(`Unable to create a unique heartbeat task id for ${base}`);
  }
}
