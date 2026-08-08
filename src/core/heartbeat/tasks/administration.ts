import type { HeartbeatRunView, HeartbeatTaskView } from '../views/types.js';
import type { HeartbeatTask } from './types.js';

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

export type ListHeartbeatRunViewsOptions = {
  taskId?: string;
  limit?: number;
};

export type ReadHeartbeatTaskOptions = {
  runLimit?: number;
};

export type HeartbeatTaskDetail = {
  task: HeartbeatTaskView;
  runs: HeartbeatRunView[];
};

/**
 * Provider-neutral operator-facing heartbeat task boundary.
 *
 * Implementations own their persistence transaction. Every mutation must read
 * the latest durable task, apply `HeartbeatTaskControlPolicy`, and persist the
 * result atomically with competing claims and settlements. This contract does
 * not make a separate `loadTask()` followed by `saveTask()` safe.
 */
export interface HeartbeatTaskAdministrationService {
  listTaskViews(): Promise<HeartbeatTaskView[]>;
  listRunViews(options?: ListHeartbeatRunViewsOptions): Promise<HeartbeatRunView[]>;
  createTask(input: CreateHeartbeatTaskInput): Promise<HeartbeatTaskView>;
  reconcileTasks(input: ReconcileHeartbeatTasksInput): Promise<ReconcileHeartbeatTasksResult>;
  updateTask(taskId: string, input: UpdateHeartbeatTaskInput): Promise<HeartbeatTaskView>;
  deleteTask(taskId: string): Promise<HeartbeatTaskView>;
  resumeTask(taskId: string): Promise<HeartbeatTaskView>;
  readTask(taskId: string, options?: ReadHeartbeatTaskOptions): Promise<HeartbeatTaskDetail>;
  readRun(taskId: string, runId: string): Promise<HeartbeatRunView | undefined>;
  setTaskEnabled(taskId: string, enabled: boolean): Promise<HeartbeatTaskView>;
  triggerTaskRun(taskId: string): Promise<HeartbeatTaskView>;
}
