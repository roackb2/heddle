import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { runAgentHeartbeat } from './heartbeat.js';
import type { AgentHeartbeatResult, HeartbeatDecision, RunAgentHeartbeatOptions } from './heartbeat.js';
import type { AgentLoopCheckpoint, AgentLoopState } from './events.js';
import type { LlmUsage } from '../llm/types.js';
import { suggestNextHeartbeatDelayMs } from './heartbeat-store.js';

export type HeartbeatTask = {
  id: string;
  task: string;
  name?: string;
  enabled: boolean;
  intervalMs: number;
  nextRunAt?: string;
  checkpointPath?: string;
  model?: string;
  maxSteps?: number;
  workspaceRoot?: string;
  stateDir?: string;
  memoryDir?: string;
  searchIgnoreDirs?: string[];
  systemContext?: string;
  lastRunAt?: string;
  lastDecision?: HeartbeatDecision;
  lastOutcome?: string;
  lastSummary?: string;
  lastError?: string;
  updatedAt?: string;
};

export type HeartbeatTaskRunRecord = {
  task: HeartbeatTask;
  result: AgentHeartbeatResult;
  loadedCheckpoint: boolean;
};

export type HeartbeatTaskRunRecordEntry = {
  id: string;
  path: string;
  taskId: string;
  runId: string;
  createdAt: string;
  record: HeartbeatTaskRunRecord;
};

export type HeartbeatTaskStore = {
  listTasks: () => Promise<HeartbeatTask[]>;
  saveTask: (task: HeartbeatTask) => Promise<void>;
  loadCheckpoint: (task: HeartbeatTask) => Promise<AgentLoopCheckpoint | undefined>;
  saveCheckpoint: (task: HeartbeatTask, checkpoint: AgentLoopCheckpoint) => Promise<void>;
  saveRunRecord?: (record: HeartbeatTaskRunRecord) => Promise<void>;
  listRunRecords?: (options?: { taskId?: string; limit?: number }) => Promise<HeartbeatTaskRunRecordEntry[]>;
  loadRunRecord?: (id: string) => Promise<HeartbeatTaskRunRecordEntry | undefined>;
};

export type FileHeartbeatTaskStoreOptions = {
  dir: string;
};

export type HeartbeatSchedulerEvent =
  | { type: 'heartbeat.scheduler.started'; timestamp: string }
  | { type: 'heartbeat.scheduler.stopped'; reason: 'aborted' | 'completed' | 'error'; timestamp: string }
  | { type: 'heartbeat.task.due'; taskId: string; timestamp: string }
  | { type: 'heartbeat.task.started'; taskId: string; loadedCheckpoint: boolean; timestamp: string }
  | {
      type: 'heartbeat.task.finished';
      taskId: string;
      decision: HeartbeatDecision;
      outcome: string;
      summary: string;
      runId: string;
      usage?: LlmUsage;
      nextRunAt?: string;
      enabled: boolean;
      timestamp: string;
    }
  | { type: 'heartbeat.task.failed'; taskId: string; error: string; nextRunAt?: string; timestamp: string };

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

export function createFileHeartbeatTaskStore(options: FileHeartbeatTaskStoreOptions): HeartbeatTaskStore {
  const tasksDir = join(options.dir, 'tasks');
  const checkpointsDir = join(options.dir, 'checkpoints');
  const runsDir = join(options.dir, 'runs');

  return {
    async listTasks() {
      if (!existsSync(tasksDir)) {
        return [];
      }

      return readdirSync(tasksDir)
        .filter((entry) => entry.endsWith('.json'))
        .map((entry) => JSON.parse(readFileSync(join(tasksDir, entry), 'utf8')) as HeartbeatTask)
        .sort((left, right) => left.id.localeCompare(right.id));
    },
    async saveTask(task) {
      const path = join(tasksDir, `${safeTaskFileName(task.id)}.json`);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify(normalizeTaskForSave(task), null, 2));
    },
    async loadCheckpoint(task) {
      const path = checkpointPathForTask(task, checkpointsDir);
      if (!existsSync(path)) {
        return undefined;
      }

      return JSON.parse(readFileSync(path, 'utf8')) as AgentLoopCheckpoint;
    },
    async saveCheckpoint(task, checkpoint) {
      const path = checkpointPathForTask(task, checkpointsDir);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify(checkpoint, null, 2));
    },
    async saveRunRecord(record) {
      const timestamp = new Date().toISOString().replaceAll(':', '-');
      const path = join(runsDir, `${timestamp}-${safeTaskFileName(record.task.id)}.json`);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify(record, null, 2));
    },
    async listRunRecords(options = {}) {
      if (!existsSync(runsDir)) {
        return [];
      }

      const entries = readdirSync(runsDir)
        .filter((entry) => entry.endsWith('.json'))
        .flatMap((entry) => {
          const path = join(runsDir, entry);
          try {
            const record = JSON.parse(readFileSync(path, 'utf8')) as HeartbeatTaskRunRecord;
            if (options.taskId && record.task.id !== options.taskId) {
              return [];
            }

            return [runRecordEntryFromPath(path, record)];
          } catch {
            return [];
          }
        })
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

      return options.limit ? entries.slice(0, options.limit) : entries;
    },
    async loadRunRecord(id) {
      const entries = await this.listRunRecords?.();
      return entries?.find((entry) => entry.id === id || entry.runId === id);
    },
  };
}

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
      options.onEvent?.({
        type: 'heartbeat.task.started',
        taskId: task.id,
        loadedCheckpoint: Boolean(checkpoint),
        timestamp: now.toISOString(),
      });

      const result = await runHeartbeatTask(task, checkpoint, options);
      const record = { task, result, loadedCheckpoint: Boolean(checkpoint) };
      await options.store.saveCheckpoint(task, result.checkpoint);
      await options.store.saveRunRecord?.(record);
      records.push(record);

      const nextTask = updateTaskAfterResult(task, result, now);
      await options.store.saveTask(nextTask);
      options.onEvent?.({
        type: 'heartbeat.task.finished',
        taskId: task.id,
        decision: result.decision,
        outcome: result.state.outcome,
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

function updateTaskAfterResult(task: HeartbeatTask, result: AgentHeartbeatResult, now: Date): HeartbeatTask {
  const terminal = result.decision === 'complete' || result.decision === 'escalate';
  const delayMs =
    terminal ? undefined
    : result.decision === 'continue' ? task.intervalMs
    : suggestNextHeartbeatDelayMs(result.decision) ?? task.intervalMs;

  return normalizeTaskForSave({
    ...task,
    enabled: terminal ? false : task.enabled,
    nextRunAt: delayMs === undefined ? undefined : new Date(now.getTime() + delayMs).toISOString(),
    lastRunAt: now.toISOString(),
    lastDecision: result.decision,
    lastOutcome: result.state.outcome,
    lastSummary: result.summary,
    lastError: undefined,
    updatedAt: now.toISOString(),
  });
}

function updateTaskAfterFailure(task: HeartbeatTask, error: unknown, now: Date, retryMs: number): HeartbeatTask {
  return normalizeTaskForSave({
    ...task,
    nextRunAt: new Date(now.getTime() + retryMs).toISOString(),
    lastRunAt: now.toISOString(),
    lastError: error instanceof Error ? error.message : String(error),
    updatedAt: now.toISOString(),
  });
}

function normalizeTaskForSave(task: HeartbeatTask): HeartbeatTask {
  return {
    ...task,
    intervalMs: Math.max(1, Math.trunc(task.intervalMs)),
  };
}

function checkpointPathForTask(task: HeartbeatTask, checkpointsDir: string): string {
  return task.checkpointPath ?? join(checkpointsDir, `${safeTaskFileName(task.id)}.json`);
}

function safeTaskFileName(id: string): string {
  if (!/^[a-zA-Z0-9._-]+$/.test(id)) {
    throw new Error(`Invalid heartbeat task id "${id}". Use only letters, numbers, dots, underscores, and hyphens.`);
  }
  return id;
}

function runRecordEntryFromPath(path: string, record: HeartbeatTaskRunRecord): HeartbeatTaskRunRecordEntry {
  const id = basename(path, '.json');
  return {
    id,
    path,
    taskId: record.task.id,
    runId: record.result.state.runId,
    createdAt: record.result.state.finishedAt,
    record,
  };
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
