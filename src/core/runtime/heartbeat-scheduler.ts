import { runAgentHeartbeat } from './heartbeat.js';
import type { AgentHeartbeatResult, HeartbeatDecision, RunAgentHeartbeatOptions } from './heartbeat.js';
import type { AgentLoopCheckpoint, AgentLoopState } from './events.js';
import type { LlmUsage } from '../llm/types.js';
import { updateTaskAfterFailure, updateTaskAfterResult } from './heartbeat-task-state.js';
import type {
  HeartbeatTask,
  HeartbeatTaskRunRecord,
  HeartbeatTaskStore,
  HeartbeatTaskStatus,
} from './heartbeat-task-store.js';

export {
  createFileHeartbeatTaskStore,
} from './heartbeat-task-store.js';
export type {
  FileHeartbeatTaskStoreOptions,
  HeartbeatTask,
  HeartbeatTaskRunRecord,
  HeartbeatTaskRunRecordEntry,
  HeartbeatTaskStore,
  HeartbeatTaskStatus,
} from './heartbeat-task-store.js';

export type HeartbeatSchedulerEvent =
  | { type: 'heartbeat.scheduler.started'; timestamp: string }
  | { type: 'heartbeat.scheduler.stopped'; reason: 'aborted' | 'completed' | 'error'; timestamp: string }
  | { type: 'heartbeat.task.due'; taskId: string; timestamp: string }
  | {
      type: 'heartbeat.task.started';
      taskId: string;
      loadedCheckpoint: boolean;
      status: HeartbeatTaskStatus;
      progress: string;
      timestamp: string;
    }
  | {
      type: 'heartbeat.task.finished';
      taskId: string;
      decision: HeartbeatDecision;
      outcome: string;
      status: HeartbeatTaskStatus;
      progress: string;
      summary: string;
      runId: string;
      usage?: LlmUsage;
      nextRunAt?: string;
      enabled: boolean;
      timestamp: string;
    }
  | {
      type: 'heartbeat.task.failed';
      taskId: string;
      error: string;
      status: HeartbeatTaskStatus;
      progress: string;
      nextRunAt?: string;
      timestamp: string;
    };

export type HeartbeatTaskRunner = (
  task: HeartbeatTask,
  checkpoint: AgentLoopState | AgentLoopCheckpoint | undefined,
) => Promise<AgentHeartbeatResult>;

export type RunDueHeartbeatTasksOptions = {
  store: HeartbeatTaskStore;
  runner?: HeartbeatTaskRunner;
  heartbeat?: Omit<RunAgentHeartbeatOptions, 'task' | 'checkpoint'>;
  now?: () => Date;
  onEvent?: (event: HeartbeatSchedulerEvent) => void;
  failureRetryMs?: number;
};

export type RunDueHeartbeatTasksResult = {
  checked: number;
  ran: number;
  failed: number;
  records: HeartbeatTaskRunRecord[];
};

export type RunHeartbeatSchedulerOptions = RunDueHeartbeatTasksOptions & {
  pollIntervalMs?: number;
  signal?: AbortSignal;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
};

const DEFAULT_FAILURE_RETRY_MS = 5 * 60_000;

export async function runDueHeartbeatTasks(options: RunDueHeartbeatTasksOptions): Promise<RunDueHeartbeatTasksResult> {
  const now = options.now?.() ?? new Date();
  const tasks = await options.store.listTasks();
  const dueTasks = tasks.filter((task) => isTaskDue(task, now));
  const records: HeartbeatTaskRunRecord[] = [];
  let failed = 0;

  for (const task of dueTasks) {
    options.onEvent?.({ type: 'heartbeat.task.due', taskId: task.id, timestamp: now.toISOString() });
    try {
      const checkpoint = await options.store.loadCheckpoint(task);
      const runningTask = {
        ...task,
        status: 'running' as const,
        lastProgress:
          checkpoint ?
            'Resuming heartbeat wake from the last checkpoint.'
          : 'Starting a new heartbeat wake cycle.',
        lastLoadedCheckpoint: Boolean(checkpoint),
        lastError: undefined,
        updatedAt: now.toISOString(),
      };
      await options.store.saveTask(runningTask);
      options.onEvent?.({
        type: 'heartbeat.task.started',
        taskId: task.id,
        loadedCheckpoint: Boolean(checkpoint),
        status: runningTask.status,
        progress: runningTask.lastProgress,
        timestamp: now.toISOString(),
      });

      const result = await runHeartbeatTask(task, checkpoint, options);
      await options.store.saveCheckpoint(task, result.checkpoint);
      const nextTask = updateTaskAfterResult(task, result, now, Boolean(checkpoint));
      await options.store.saveTask(nextTask);
      const record = { task: nextTask, result, loadedCheckpoint: Boolean(checkpoint) };
      await options.store.saveRunRecord?.(record);
      records.push(record);
      options.onEvent?.({
        type: 'heartbeat.task.finished',
        taskId: task.id,
        decision: result.decision,
        outcome: result.state.outcome,
        status: nextTask.status ?? 'waiting',
        progress: nextTask.lastProgress ?? '',
        summary: result.summary,
        runId: result.state.runId,
        usage: result.state.usage,
        nextRunAt: nextTask.nextRunAt,
        enabled: nextTask.enabled,
        timestamp: now.toISOString(),
      });
    } catch (error) {
      failed++;
      const nextTask = updateTaskAfterFailure(task, error, now, options.failureRetryMs ?? DEFAULT_FAILURE_RETRY_MS);
      await options.store.saveTask(nextTask);
      options.onEvent?.({
        type: 'heartbeat.task.failed',
        taskId: task.id,
        error: error instanceof Error ? error.message : String(error),
        status: nextTask.status ?? 'failed',
        progress: nextTask.lastProgress ?? '',
        nextRunAt: nextTask.nextRunAt,
        timestamp: now.toISOString(),
      });
    }
  }

  return {
    checked: tasks.length,
    ran: records.length,
    failed,
    records,
  };
}

export async function runHeartbeatScheduler(options: RunHeartbeatSchedulerOptions): Promise<void> {
  options.onEvent?.({ type: 'heartbeat.scheduler.started', timestamp: (options.now?.() ?? new Date()).toISOString() });
  try {
    while (!options.signal?.aborted) {
      await runDueHeartbeatTasks(options);
      await (options.sleep ?? sleep)(options.pollIntervalMs ?? 60_000, options.signal);
    }
    options.onEvent?.({ type: 'heartbeat.scheduler.stopped', reason: 'aborted', timestamp: (options.now?.() ?? new Date()).toISOString() });
  } catch (error) {
    if (options.signal?.aborted) {
      options.onEvent?.({ type: 'heartbeat.scheduler.stopped', reason: 'aborted', timestamp: (options.now?.() ?? new Date()).toISOString() });
      return;
    }

    options.onEvent?.({ type: 'heartbeat.scheduler.stopped', reason: 'error', timestamp: (options.now?.() ?? new Date()).toISOString() });
    throw error;
  }
}

function isTaskDue(task: HeartbeatTask, now: Date): boolean {
  if (!task.enabled) {
    return false;
  }

  if (!task.nextRunAt) {
    return true;
  }

  const nextRunAt = Date.parse(task.nextRunAt);
  return Number.isFinite(nextRunAt) && nextRunAt <= now.getTime();
}

async function runHeartbeatTask(
  task: HeartbeatTask,
  checkpoint: AgentLoopState | AgentLoopCheckpoint | undefined,
  options: RunDueHeartbeatTasksOptions,
): Promise<AgentHeartbeatResult> {
  if (options.runner) {
    return options.runner(task, checkpoint);
  }

  return runAgentHeartbeat({
    ...options.heartbeat,
    task: task.task,
    checkpoint,
    model: task.model ?? options.heartbeat?.model,
    maxSteps: task.maxSteps ?? options.heartbeat?.maxSteps,
    workspaceRoot: task.workspaceRoot ?? options.heartbeat?.workspaceRoot,
    stateDir: task.stateDir ?? options.heartbeat?.stateDir,
    memoryDir: task.memoryDir ?? options.heartbeat?.memoryDir,
    searchIgnoreDirs: task.searchIgnoreDirs ?? options.heartbeat?.searchIgnoreDirs,
    systemContext: task.systemContext ?? options.heartbeat?.systemContext,
  });
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
  });
}
