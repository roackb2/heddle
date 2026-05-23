import { resolve } from 'node:path';
import {
  FileHeartbeatTaskRepository,
  HeartbeatSchedulerService,
  HeartbeatViewsPresenter,
  type HeartbeatTask,
  type HeartbeatTaskRunner,
  type HeartbeatTaskStore,
} from '@/core/heartbeat/index.js';
import { DEFAULT_OPENAI_MODEL } from '@/core/config.js';
import { RuntimeCredentialService } from '@/core/runtime/credentials/index.js';
import type { ToolCall, ToolDefinition } from '@/core/types.js';

type CreateHeartbeatTaskArgs = {
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

type RunHeartbeatTaskNowArgs = {
  taskId: string;
  workspaceRoot: string;
  stateDir?: string;
  apiKey?: string;
  preferApiKey?: boolean;
  model?: string;
  maxSteps?: number;
  searchIgnoreDirs?: string[];
  systemContext?: string;
  runner?: HeartbeatTaskRunner;
};

export class ControlPlaneHeartbeatController {
  static createStore(stateRoot: string): HeartbeatTaskStore {
    return new FileHeartbeatTaskRepository({ dir: resolve(stateRoot, 'heartbeat') });
  }

  static async listTasks(stateRoot: string) {
    return await HeartbeatViewsPresenter.listTaskViews(ControlPlaneHeartbeatController.createStore(stateRoot));
  }

  static async listRuns(
    stateRoot: string,
    options: { taskId?: string; limit?: number } = {},
  ) {
    return await HeartbeatViewsPresenter.listRunViews(ControlPlaneHeartbeatController.createStore(stateRoot), options);
  }

  static async createTask(
    stateRoot: string,
    args: CreateHeartbeatTaskArgs,
  ) {
    const store = ControlPlaneHeartbeatController.createStore(stateRoot);
    const tasks = await store.listTasks();
    const now = new Date();
    const id = args.id ?? ControlPlaneHeartbeatController.createTaskId(args.name ?? args.task, tasks.map((task) => task.id));
    if (tasks.some((task) => task.id === id)) {
      throw new Error(`Heartbeat task already exists: ${id}`);
    }

    const intervalMs = args.intervalMs ?? 60 * 60_000;
    const task: HeartbeatTask = {
      id,
      workspaceId: args.workspaceId,
      name: args.name,
      task: args.task.trim(),
      enabled: args.enabled ?? true,
      schedule: {
        intervalMs,
        nextRunAt: args.defer === false ? new Date(now.getTime() - 1_000).toISOString() : new Date(now.getTime() + intervalMs).toISOString(),
      },
      runtime: {
        model: args.model,
        maxSteps: args.maxSteps,
        workspaceRoot: args.workspaceRoot,
        stateDir: args.stateDir,
        searchIgnoreDirs: args.searchIgnoreDirs,
        systemContext: args.systemContext,
      },
      state: {
        status: args.enabled === false ? 'idle' : 'waiting',
        updatedAt: now.toISOString(),
      },
    };

    await store.saveTask(task);
    return HeartbeatViewsPresenter.projectTask(task);
  }

  static async readTask(
    stateRoot: string,
    taskId: string,
    options: { runLimit?: number } = {},
  ) {
    const store = ControlPlaneHeartbeatController.createStore(stateRoot);
    const task = await ControlPlaneHeartbeatController.loadTaskById(store, taskId);
    const runs = await HeartbeatViewsPresenter.listRunViews(store, {
      taskId,
      limit: options.runLimit ?? 50,
    });

    return {
      task: HeartbeatViewsPresenter.projectTask(task),
      runs,
    };
  }

  static async readRun(
    stateRoot: string,
    taskId: string,
    runId: string,
  ) {
    const store = ControlPlaneHeartbeatController.createStore(stateRoot);
    await ControlPlaneHeartbeatController.loadTaskById(store, taskId);
    return await HeartbeatViewsPresenter.loadRunView(store, runId, { taskId });
  }

  static async setTaskEnabled(
    stateRoot: string,
    taskId: string,
    enabled: boolean,
  ) {
    const store = ControlPlaneHeartbeatController.createStore(stateRoot);
    const task = await ControlPlaneHeartbeatController.loadTaskById(store, taskId);
    const now = new Date();
    const status = enabled ? (task.state?.status ?? 'waiting') : (task.state?.status === 'running' ? 'running' : 'idle');
    const nextTask: HeartbeatTask = {
      ...task,
      enabled,
      schedule: {
        ...task.schedule,
        nextRunAt:
          enabled ?
            task.schedule.nextRunAt ?? new Date(now.getTime() - 1_000).toISOString()
          : undefined,
      },
      state: {
        ...task.state,
        status,
        updatedAt: now.toISOString(),
      },
    };
    await store.saveTask(nextTask);
    return HeartbeatViewsPresenter.projectTask(nextTask);
  }

  static async triggerTaskRun(stateRoot: string, taskId: string) {
    const store = ControlPlaneHeartbeatController.createStore(stateRoot);
    const task = await ControlPlaneHeartbeatController.loadTaskById(store, taskId);
    if (!task.enabled) {
      throw new Error(`Heartbeat task ${taskId} is disabled. Enable it before triggering a run.`);
    }

    const now = new Date();
    const status = task.state?.status === 'running' ? 'running' : 'waiting';
    const nextTask: HeartbeatTask = {
      ...task,
      schedule: {
        ...task.schedule,
        nextRunAt: new Date(now.getTime() - 1_000).toISOString(),
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
    await store.saveTask(nextTask);
    return HeartbeatViewsPresenter.projectTask(nextTask);
  }

  static async runTaskNow(
    stateRoot: string,
    args: RunHeartbeatTaskNowArgs,
  ) {
    const store = ControlPlaneHeartbeatController.createStore(stateRoot);
    const task = await ControlPlaneHeartbeatController.loadTaskById(store, args.taskId);
    const model = args.model ?? task.runtime?.model ?? process.env.OPENAI_MODEL ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_OPENAI_MODEL;
    const runtimeCredential = args.apiKey ?
      { apiKey: args.apiKey, apiKeyProvider: 'explicit' as const, preferApiKey: args.preferApiKey }
    : { preferApiKey: args.preferApiKey };
    if (!args.runner && !RuntimeCredentialService.hasCredentialForModel(model, runtimeCredential)) {
      throw new Error(RuntimeCredentialService.formatMissingCredentialMessage(model));
    }

    const apiKey = RuntimeCredentialService.resolveApiKeyForModel(model, runtimeCredential);
    const result = await HeartbeatSchedulerService.runTaskNow({
      store,
      taskId: args.taskId,
      runner: args.runner,
      heartbeat: args.runner ? undefined : {
        model,
        apiKey,
        maxSteps: args.maxSteps,
        workspaceRoot: args.workspaceRoot,
        stateDir: args.stateDir,
        searchIgnoreDirs: args.searchIgnoreDirs,
        systemContext: args.systemContext,
        approveToolCall: ControlPlaneHeartbeatController.denyInteractiveToolApproval,
      },
    });
    const [run] = await HeartbeatViewsPresenter.listRunViews(store, {
      taskId: args.taskId,
      limit: 1,
    });
    return {
      ...result,
      task: HeartbeatViewsPresenter.projectTask((await ControlPlaneHeartbeatController.loadTaskById(store, args.taskId))),
      run: run ?? null,
    };
  }

  private static async loadTaskById(
    store: ReturnType<typeof ControlPlaneHeartbeatController.createStore>,
    taskId: string,
  ): Promise<HeartbeatTask> {
    const tasks = await store.listTasks();
    const task = tasks.find((candidate) => candidate.id === taskId);
    if (!task) {
      throw new Error(`Heartbeat task not found: ${taskId}`);
    }
    return task;
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

  private static async denyInteractiveToolApproval(
    call: ToolCall,
    _toolDef: ToolDefinition,
  ): Promise<{ approved: boolean; reason?: string }> {
    return {
      approved: false,
      reason:
        call.tool === 'edit_file' || call.tool === 'run_shell_mutate' ?
          'Immediate heartbeat runs do not yet have a live approval UI. Use read-only tools or run the task from an interactive session for approved workspace changes.'
        : 'Immediate heartbeat runs cannot approve this tool call interactively.',
    };
  }
}
