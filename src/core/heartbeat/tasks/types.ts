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

/**
 * Identifies one owned attempt to execute a heartbeat task.
 *
 * Hosted stores must treat `executionId` as a fencing token: completion,
 * failure, skip, and cancellation writes are valid only while this exact
 * execution still owns the task. `ownerId` identifies the scheduler process/
 * worker generation for operator diagnostics and explicit recovery.
 */
export type HeartbeatTaskExecution = {
  executionId: string;
  ownerId: string;
  claimedAt: string;
};

export type HeartbeatTaskRecoveryReason = 'host-restart' | 'operator';

export type HeartbeatTaskRecovery = {
  interruptedExecutionId: string;
  interruptedOwnerId: string;
  recoveredAt: string;
  reason: HeartbeatTaskRecoveryReason;
};

type HeartbeatTaskExecutionOutcomeBase = {
  executionId: string;
  summary: string;
  finishedAt: string;
};

export type HeartbeatTaskExecutionOutcome = HeartbeatTaskExecutionOutcomeBase & (
  | { kind: 'agent' }
  | { kind: 'skipped' }
  | { kind: 'cancelled' }
  | { kind: 'failed' }
);

export type HeartbeatTaskState = {
  status?: HeartbeatTaskStatus;
  progress?: string;
  runId?: string;
  runAt?: string;
  loadedCheckpoint?: boolean;
  resumable?: boolean;
  result?: AgentHeartbeatResult;
  error?: string;
  execution?: HeartbeatTaskExecution;
  lastExecution?: HeartbeatTaskExecutionOutcome;
  recovery?: HeartbeatTaskRecovery;
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

export type HeartbeatTaskAgentRunRecord = {
  task: HeartbeatTask;
  result: AgentHeartbeatResult;
  loadedCheckpoint: boolean;
  /** Present on records created after execution correlation was introduced. */
  outcome?: HeartbeatTaskExecutionOutcome & { kind: 'agent' };
};

export type HeartbeatTaskNonAgentRunRecord = {
  task: HeartbeatTask;
  outcome: HeartbeatTaskExecutionOutcome & { kind: 'skipped' | 'cancelled' };
  result?: never;
  loadedCheckpoint?: never;
};

export type HeartbeatTaskRunRecord = HeartbeatTaskAgentRunRecord | HeartbeatTaskNonAgentRunRecord;

export type HeartbeatTaskRunRecordEntry = {
  id: string;
  path: string;
  taskId: string;
  workspaceId?: string;
  executionId: string;
  runId?: string;
  createdAt: string;
  record: HeartbeatTaskRunRecord;
};

export type HeartbeatTaskClaimResult =
  | { status: 'claimed'; task: HeartbeatTask }
  | { status: 'busy' | 'disabled' | 'not-found' };

export type HeartbeatTaskExecutionWriteResult =
  | { status: 'saved'; task: HeartbeatTask; record?: HeartbeatTaskRunRecord }
  | { status: 'claim-lost' | 'cancelled' };

export type HeartbeatTaskRecoveryResult = {
  task: HeartbeatTask;
  recovery: HeartbeatTaskRecovery;
};

export type HeartbeatTaskStore = {
  listTasks: () => Promise<HeartbeatTask[]>;
  saveTask: (task: HeartbeatTask) => Promise<void>;
  loadCheckpoint: (task: HeartbeatTask) => Promise<AgentLoopCheckpoint | undefined>;
  saveCheckpoint: (task: HeartbeatTask, checkpoint: AgentLoopCheckpoint) => Promise<void>;
  claimTaskExecution: (input: {
    taskId: string;
    execution: HeartbeatTaskExecution;
    loadedCheckpoint: boolean;
    claimedAt: Date;
  }) => Promise<HeartbeatTaskClaimResult>;
  completeTaskExecution: (input: {
    execution: HeartbeatTaskExecution;
    task: HeartbeatTask;
    checkpoint: AgentLoopCheckpoint;
    result: AgentHeartbeatResult;
    loadedCheckpoint: boolean;
    signal?: AbortSignal;
  }) => Promise<HeartbeatTaskExecutionWriteResult>;
  failTaskExecution: (input: {
    execution: HeartbeatTaskExecution;
    task: HeartbeatTask;
    signal?: AbortSignal;
  }) => Promise<HeartbeatTaskExecutionWriteResult>;
  recordTaskExecutionOutcome: (input: {
    execution: HeartbeatTaskExecution;
    task: HeartbeatTask;
    outcome: HeartbeatTaskExecutionOutcome & { kind: 'skipped' | 'cancelled' };
    signal?: AbortSignal;
  }) => Promise<HeartbeatTaskExecutionWriteResult>;
  recoverInterruptedTasks: (input: {
    ownerId: string;
    recoveredAt: Date;
    reason: HeartbeatTaskRecoveryReason;
  }) => Promise<HeartbeatTaskRecoveryResult[]>;
  saveRunRecord?: (record: HeartbeatTaskRunRecord) => Promise<void>;
  listRunRecords?: (options?: { taskId?: string; limit?: number }) => Promise<HeartbeatTaskRunRecordEntry[]>;
  loadRunRecord?: (id: string) => Promise<HeartbeatTaskRunRecordEntry | undefined>;
};

export type FileHeartbeatTaskRepositoryOptions = {
  dir: string;
};
