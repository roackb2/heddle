import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { AgentHeartbeatResult, HeartbeatDecision } from './heartbeat.js';
import type { AgentLoopCheckpoint } from './events.js';
import type { LlmUsage } from '../llm/types.js';

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
  status?: HeartbeatTaskStatus;
  lastProgress?: string;
  lastRunId?: string;
  lastLoadedCheckpoint?: boolean;
  resumable?: boolean;
  lastUsage?: LlmUsage;
  lastDecision?: HeartbeatDecision;
  lastOutcome?: string;
  lastSummary?: string;
  lastError?: string;
  updatedAt?: string;
};

export type HeartbeatTaskStatus =
  | 'idle'
  | 'running'
  | 'waiting'
  | 'blocked'
  | 'complete'
  | 'failed';

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

export function normalizeTaskForSave(task: HeartbeatTask): HeartbeatTask {
  return {
    ...task,
    intervalMs: Math.max(1, Math.trunc(task.intervalMs)),
    status: task.status ?? 'idle',
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
