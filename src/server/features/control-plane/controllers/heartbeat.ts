import { resolve } from 'node:path';
import {
  createFileHeartbeatTaskStore,
  listHeartbeatRunViews,
  listHeartbeatTaskViews,
  projectHeartbeatTaskView,
  type HeartbeatTask,
} from '../../../../index.js';

export class ControlPlaneHeartbeatController {
  static createStore(stateRoot: string) {
    return createFileHeartbeatTaskStore({ dir: resolve(stateRoot, 'heartbeat') });
  }

  static async listTasks(stateRoot: string) {
    return await listHeartbeatTaskViews(ControlPlaneHeartbeatController.createStore(stateRoot));
  }

  static async listRuns(
    stateRoot: string,
    options: { taskId?: string; limit?: number } = {},
  ) {
    return await listHeartbeatRunViews(ControlPlaneHeartbeatController.createStore(stateRoot), options);
  }

  static async setTaskEnabled(
    stateRoot: string,
    taskId: string,
    enabled: boolean,
  ) {
    const store = ControlPlaneHeartbeatController.createStore(stateRoot);
    const task = await ControlPlaneHeartbeatController.loadTaskById(store, taskId);
    const now = new Date();
    const status = enabled ? (task.status ?? 'waiting') : (task.status === 'running' ? 'running' : 'idle');
    const nextTask: HeartbeatTask = {
      ...task,
      enabled,
      status,
      nextRunAt:
        enabled ?
          task.nextRunAt ?? new Date(now.getTime() - 1_000).toISOString()
        : undefined,
      updatedAt: now.toISOString(),
    };
    await store.saveTask(nextTask);
    return projectHeartbeatTaskView(nextTask);
  }

  static async triggerTaskRun(stateRoot: string, taskId: string) {
    const store = ControlPlaneHeartbeatController.createStore(stateRoot);
    const task = await ControlPlaneHeartbeatController.loadTaskById(store, taskId);
    if (!task.enabled) {
      throw new Error(`Heartbeat task ${taskId} is disabled. Enable it before triggering a run.`);
    }

    const now = new Date();
    const status = task.status === 'running' ? 'running' : 'waiting';
    const nextTask: HeartbeatTask = {
      ...task,
      status,
      lastProgress:
        task.status === 'running' ?
          task.lastProgress
        : 'Task manually triggered from control plane. Waiting for the next heartbeat worker poll.',
      nextRunAt: new Date(now.getTime() - 1_000).toISOString(),
      updatedAt: now.toISOString(),
    };
    await store.saveTask(nextTask);
    return projectHeartbeatTaskView(nextTask);
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
