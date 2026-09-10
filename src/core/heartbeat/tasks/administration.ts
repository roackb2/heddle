import type { HeartbeatRunView, HeartbeatTaskView } from '../views/types.js';
import type { HeartbeatTask } from './types.js';

export type CreateHeartbeatTaskInput = {
  workspaceId?: string;
  id?: string;
  name?: string;
  admissionGroupId?: string;
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
  /** Set `null` to return this task to namespace-only admission. */
  admissionGroupId?: string | null;
  task?: string;
  enabled?: boolean;
  continuationMode?: HeartbeatTask['continuationMode'];
  intervalMs?: number;
  model?: string | null;
  maxSteps?: number | null;
  searchIgnoreDirs?: string[];
  systemContext?: string;
};

export type HeartbeatExistingTaskPolicy = 'preserve' | 'synchronize-configuration';

export type ReconcileHeartbeatTasksInput = {
  /** Prefix that limits this reconciliation to tasks owned by one host concern. */
  namespace: string;
  /** Desired members of the namespace. */
  desired: readonly HeartbeatTask[];
  /**
   * Existing members are preserved by default. Code-owned catalogs may opt in
   * to synchronizing mutable configuration without replacing durable runtime
   * state, checkpoint identity, or run history. Scheduling state is preserved
   * unless the desired `enabled` value requires a normal enablement transition.
   */
  existingTaskPolicy?: HeartbeatExistingTaskPolicy;
};

export type ReconcileHeartbeatTasksResult = {
  created: HeartbeatTask[];
  /** Existing desired tasks whose mutable configuration changed. */
  updated: HeartbeatTask[];
  deleted: HeartbeatTask[];
  /** Running tasks retained with their execution claim and state intact. */
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
