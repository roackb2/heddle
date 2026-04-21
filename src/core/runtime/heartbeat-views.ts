import type {
  HeartbeatTask,
  HeartbeatTaskRunRecordEntry,
  HeartbeatTaskStatus,
  HeartbeatTaskStore,
} from './heartbeat-task-store.js';
import type { HeartbeatDecision } from './heartbeat.js';
import type { LlmUsage } from '../llm/types.js';

export type HeartbeatTaskView = {
  taskId: string;
  workspaceId?: string;
  name?: string;
  task: string;
  enabled: boolean;
  status: HeartbeatTaskStatus;
  decision?: HeartbeatDecision;
  outcome?: string;
  progress?: string;
  summary?: string;
  nextRunAt?: string;
  lastRunAt?: string;
  lastRunId?: string;
  loadedCheckpoint?: boolean;
  resumable: boolean;
  usage?: LlmUsage;
  error?: string;
  intervalMs: number;
  model?: string;
};

export type HeartbeatRunView = {
  id: string;
  taskId: string;
  workspaceId?: string;
  runId: string;
  createdAt: string;
  task: string;
  enabled: boolean;
  status: HeartbeatTaskStatus;
  decision: HeartbeatDecision;
  outcome: string;
  progress?: string;
  summary: string;
  loadedCheckpoint: boolean;
  resumable: boolean;
  usage?: LlmUsage;
};

export async function listHeartbeatTaskViews(store: HeartbeatTaskStore): Promise<HeartbeatTaskView[]> {
  return (await store.listTasks()).map(projectHeartbeatTaskView);
}

export async function listHeartbeatRunViews(
  store: HeartbeatTaskStore,
  options: { taskId?: string; limit?: number } = {},
): Promise<HeartbeatRunView[]> {
  const runs = await store.listRunRecords?.(options);
  return (runs ?? []).map(projectHeartbeatRunView);
}

export async function loadHeartbeatRunView(
  store: HeartbeatTaskStore,
  id: string,
  options: { taskId?: string } = {},
): Promise<HeartbeatRunView | undefined> {
  const run =
    id === 'latest' ?
      (await store.listRunRecords?.({ taskId: options.taskId, limit: 1 }))?.[0]
    : await store.loadRunRecord?.(id);
  if (!run) {
    return undefined;
  }
  if (options.taskId && run.taskId !== options.taskId) {
    return undefined;
  }
  return projectHeartbeatRunView(run);
}

export function projectHeartbeatTaskView(task: HeartbeatTask): HeartbeatTaskView {
  return {
    taskId: task.id,
    workspaceId: task.workspaceId,
    name: task.name,
    task: task.task,
    enabled: task.enabled,
    status: task.status ?? 'idle',
    decision: task.lastDecision,
    outcome: task.lastOutcome,
    progress: task.lastProgress,
    summary: task.lastSummary,
    nextRunAt: task.nextRunAt,
    lastRunAt: task.lastRunAt,
    lastRunId: task.lastRunId,
    loadedCheckpoint: task.lastLoadedCheckpoint,
    resumable: task.resumable ?? true,
    usage: task.lastUsage,
    error: task.lastError,
    intervalMs: task.intervalMs,
    model: task.model,
  };
}

export function projectHeartbeatRunView(run: HeartbeatTaskRunRecordEntry): HeartbeatRunView {
  return {
    id: run.id,
    taskId: run.taskId,
    workspaceId: run.workspaceId,
    runId: run.runId,
    createdAt: run.createdAt,
    task: run.record.task.task,
    enabled: run.record.task.enabled,
    status: run.record.task.status ?? 'idle',
    decision: run.record.result.decision,
    outcome: run.record.result.state.outcome,
    progress: run.record.task.lastProgress,
    summary: run.record.result.summary,
    loadedCheckpoint: run.record.loadedCheckpoint,
    resumable: run.record.task.resumable ?? true,
    usage: run.record.result.state.usage,
  };
}
