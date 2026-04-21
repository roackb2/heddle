import { resolve } from 'node:path';
import {
  createFileHeartbeatTaskStore,
  listHeartbeatRunViews,
  listHeartbeatTaskViews,
  projectHeartbeatTaskView,
  type HeartbeatTask,
} from '../../../../index.js';

export function createHeartbeatStore(stateRoot: string) {
  return createFileHeartbeatTaskStore({ dir: resolve(stateRoot, 'heartbeat') });
}

export async function listControlPlaneHeartbeatTasks(stateRoot: string) {
  return await listHeartbeatTaskViews(createHeartbeatStore(stateRoot));
}

export async function listControlPlaneHeartbeatRuns(
  stateRoot: string,
  options: { taskId?: string; limit?: number } = {},
) {
  return await listHeartbeatRunViews(createHeartbeatStore(stateRoot), options);
}

export async function setControlPlaneHeartbeatTaskEnabled(
  stateRoot: string,
  taskId: string,
  enabled: boolean,
) {
  const store = createHeartbeatStore(stateRoot);
  const task = await loadHeartbeatTaskById(store, taskId);
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

export async function triggerControlPlaneHeartbeatTaskRun(stateRoot: string, taskId: string) {
  const store = createHeartbeatStore(stateRoot);
  const task = await loadHeartbeatTaskById(store, taskId);
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

async function loadHeartbeatTaskById(
  store: ReturnType<typeof createHeartbeatStore>,
  taskId: string,
): Promise<HeartbeatTask> {
  const tasks = await store.listTasks();
  const task = tasks.find((candidate) => candidate.id === taskId);
  if (!task) {
    throw new Error(`Heartbeat task not found: ${taskId}`);
  }
  return task;
}
