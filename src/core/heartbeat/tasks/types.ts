import type { AgentLoopCheckpoint } from '@/core/runtime/loop/index.js';
import type { AgentHeartbeatResult, RunAgentHeartbeatOptions } from '../agent/index.js';

export type HeartbeatTaskStatus =
  | 'idle'
  | 'running'
  | 'waiting'
  | 'blocked'
  | 'complete'
  | 'failed';

export type HeartbeatTaskSchedule = {
  intervalMs: number;
  nextRunAt?: string;
};

export type HeartbeatTaskContinuationMode = 'operator' | 'agent';

export type HeartbeatTaskRuntime = Pick<
  RunAgentHeartbeatOptions,
  | 'model'
  | 'maxSteps'
  | 'workspaceRoot'
  | 'stateDir'
  | 'memoryDir'
  | 'searchIgnoreDirs'
  | 'systemContext'
>;

export type HeartbeatTaskState = {
  status?: HeartbeatTaskStatus;
  progress?: string;
  runId?: string;
  runAt?: string;
  loadedCheckpoint?: boolean;
  resumable?: boolean;
  result?: AgentHeartbeatResult;
  error?: string;
  updatedAt?: string;
};

export type HeartbeatTask = {
  id: string;
  workspaceId?: string;
  task: string;
  name?: string;
  enabled: boolean;
  continuationMode?: HeartbeatTaskContinuationMode;
  checkpointPath?: string;
  schedule: HeartbeatTaskSchedule;
  runtime?: HeartbeatTaskRuntime;
  state?: HeartbeatTaskState;
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
  workspaceId?: string;
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

export type FileHeartbeatTaskRepositoryOptions = {
  dir: string;
};
