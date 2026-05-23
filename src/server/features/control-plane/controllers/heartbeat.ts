import { resolve } from 'node:path';
import {
  FileHeartbeatTaskRepository,
  HeartbeatViewsPresenter,
  type HeartbeatTask,
  type HeartbeatTaskStore,
} from '@/core/heartbeat/index.js';

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
}
