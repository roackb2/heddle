import { resolve } from 'node:path';
import dayjs from 'dayjs';
import omit from 'lodash/omit.js';
import orderBy from 'lodash/orderBy.js';
import { FileHeartbeatTaskRepository } from './repository.js';
import type {
  FileHeartbeatTaskRepositoryOptions,
  HeartbeatTask,
  HeartbeatTaskState,
  HeartbeatTaskRunRecord,
  HeartbeatTaskRunRecordEntry,
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
  intervalMs?: number;
  model?: string | null;
  maxSteps?: number | null;
  searchIgnoreDirs?: string[];
  systemContext?: string;
};

/**
 * Heartbeat task service.
 *
 * This is the persistence boundary for durable heartbeat tasks, checkpoints,
 * run records, and operator-facing task/run projections. Hosts should call this
 * service, not the file repository.
 */
export class FileHeartbeatTaskService implements HeartbeatTaskStore {
  private readonly repository: FileHeartbeatTaskRepository;

  constructor(options: FileHeartbeatTaskServiceOptions) {
    this.repository = new FileHeartbeatTaskRepository({
      dir: FileHeartbeatTaskService.resolveHeartbeatRoot(options),
    });
  }

  async listTasks() {
    return await this.repository.listTasks();
  }

  async saveTask(task: HeartbeatTask) {
    await this.repository.saveTask(task);
  }

  async loadCheckpoint(task: HeartbeatTask) {
    return await this.repository.loadCheckpoint(task);
  }

  async saveCheckpoint(task: HeartbeatTask, checkpoint: Parameters<HeartbeatTaskStore['saveCheckpoint']>[1]) {
    await this.repository.saveCheckpoint(task, checkpoint);
  }

  async saveRunRecord(record: Parameters<NonNullable<HeartbeatTaskStore['saveRunRecord']>>[0]) {
    await this.repository.saveRunRecord?.(record);
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
    const tasks = await this.listTasks();
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

    await this.saveTask(task);
    return FileHeartbeatTaskService.projectTaskView(task);
  }

  async updateTask(taskId: string, input: UpdateHeartbeatTaskInput) {
    const task = await this.requireTask(taskId);
    const now = dayjs();
    const intervalMs = input.intervalMs ?? task.schedule.intervalMs;
    const running = task.state?.status === 'running';
    const nextTask: HeartbeatTask = {
      ...task,
      name: input.name ?? task.name,
      task: input.task?.trim() ?? task.task,
      enabled: input.enabled ?? task.enabled,
      schedule: {
        ...task.schedule,
        intervalMs,
        nextRunAt: running ? task.schedule.nextRunAt : now.add(intervalMs, 'millisecond').toISOString(),
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
        updatedAt: now.toISOString(),
      },
    };

    await this.saveTask(nextTask);
    return FileHeartbeatTaskService.projectTaskView(nextTask);
  }

  async deleteTask(taskId: string) {
    const task = await this.requireTask(taskId);
    if (task.state?.status === 'running') {
      throw new Error(`Heartbeat task ${taskId} is running. Wait for the run to finish before deleting it.`);
    }

    await this.repository.deleteTask(task);
    return FileHeartbeatTaskService.projectTaskView(task);
  }

  async resumeTask(taskId: string) {
    const task = await this.requireTask(taskId);
    if (task.state?.status === 'running') {
      throw new Error(`Heartbeat task ${taskId} is already running.`);
    }
    if (task.state?.resumable === false) {
      throw new Error(`Heartbeat task ${taskId} cannot be resumed.`);
    }

    const now = dayjs();
    const nextTask: HeartbeatTask = {
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

    await this.saveTask(nextTask);
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
    const task = await this.requireTask(taskId);
    const now = dayjs();
    const status = enabled ? (task.state?.status ?? 'waiting') : (task.state?.status === 'running' ? 'running' : 'idle');
    const nextTask: HeartbeatTask = {
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
        updatedAt: now.toISOString(),
      },
    };
    await this.saveTask(nextTask);
    return FileHeartbeatTaskService.projectTaskView(nextTask);
  }

  async triggerTaskRun(taskId: string) {
    const task = await this.requireTask(taskId);
    if (!task.enabled) {
      throw new Error(`Heartbeat task ${taskId} is disabled. Enable it before triggering a run.`);
    }

    const now = dayjs();
    const status = task.state?.status === 'running' ? 'running' : 'waiting';
    const nextTask: HeartbeatTask = {
      ...task,
      schedule: {
        ...task.schedule,
        nextRunAt: now.subtract(1, 'second').toISOString(),
      },
      state: {
        ...task.state,
        status,
        progress:
          task.state?.status === 'running' ?
            task.state.progress
          : 'Task manually triggered from control plane. Waiting for the next heartbeat worker poll.',
        updatedAt: now.toISOString(),
      },
    };
    await this.saveTask(nextTask);
    return FileHeartbeatTaskService.projectTaskView(nextTask);
  }

  async requireTask(taskId: string): Promise<HeartbeatTask> {
    const tasks = await this.listTasks();
    const task = tasks.find((candidate) => candidate.id === taskId);
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
    const runId = record.result.state.runId;
    return {
      id: runId,
      taskId: record.task.id,
      runId,
      workspaceId: record.task.workspaceId,
      createdAt: record.result.state.finishedAt,
      task: FileHeartbeatTaskService.projectTaskView(record.task),
      result: FileHeartbeatTaskService.projectResultView(record.result),
      loadedCheckpoint: record.loadedCheckpoint,
    };
  }

  private static projectTaskStateView(state: HeartbeatTaskState | undefined): HeartbeatTaskView['state'] {
    const result = state?.result;
    return {
      ...omit(state ?? {}, ['result']),
      status: state?.status ?? 'idle',
      result: result ? FileHeartbeatTaskService.projectResultView(result) : undefined,
    };
  }

  private static projectResultView(result: AgentHeartbeatResult): HeartbeatTaskResultView {
    return {
      decision: result.decision,
      summary: result.summary,
      outcome: result.state.outcome,
      usage: result.state.usage,
    };
  }

  private static taskLastRunTime(task: HeartbeatTaskView): number {
    const runAt = task.state.runAt ? dayjs(task.state.runAt) : undefined;
    return runAt?.isValid() ? runAt.valueOf() : 0;
  }

  private static resolveHeartbeatRoot(options: FileHeartbeatTaskServiceOptions): string {
    if ('dir' in options) {
      return options.dir;
    }

    if ('stateRoot' in options) {
      return resolve(options.stateRoot, 'heartbeat');
    }

    return resolve(options.workspaceRoot, options.stateDir ?? '.heddle', 'heartbeat');
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
