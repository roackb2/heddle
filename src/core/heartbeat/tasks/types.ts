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

export const MAX_HEARTBEAT_RUN_REQUEST_REASON_LENGTH = 200;
export const MAX_HEARTBEAT_CANCELLATION_REASON_LENGTH = 200;
export const DEFAULT_HEARTBEAT_HANDLER_RETRY_MS = 5 * 60_000;
export const MAX_HEARTBEAT_HANDLER_RETRY_MS = 24 * 60 * 60_000;
export const MAX_HEARTBEAT_HANDLER_OUTCOME_SUMMARY_LENGTH = 500;

/**
 * Durable level-triggered intent to run a task promptly.
 *
 * `generation` advances for every accepted request. `claimedGeneration` is the
 * newest generation already claimed by an execution, so a larger generation
 * represents one pending follow-up regardless of how many requests coalesced.
 */
export type HeartbeatTaskRunRequest = {
  generation: number;
  claimedGeneration: number;
  requestedAt: string;
  reason?: string;
};

export type RequestHeartbeatTaskRunOptions = {
  reason?: string;
  requestedAt?: Date;
};

export type HeartbeatTaskRunRequestSignal = {
  taskId: string;
  generation: number;
  disposition: 'requested' | 'coalesced';
  requestedAt: string;
  reason?: string;
};

export type HeartbeatTaskRunRequestResult = HeartbeatTaskRunRequestSignal & {
  task: HeartbeatTask;
};

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
  runRequestGeneration?: number;
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
  runRequestGeneration?: number;
};

export type HeartbeatTaskExecutionOutcome =
  | (HeartbeatTaskExecutionOutcomeBase & { kind: 'agent' })
  | (HeartbeatTaskExecutionOutcomeBase & { kind: 'skipped' })
  | (HeartbeatTaskExecutionOutcomeBase & {
      kind: 'retry';
      /** Nested agent run rejected by the custom handler. */
      agentRunId: string;
    })
  | (HeartbeatTaskExecutionOutcomeBase & {
      kind: 'blocked';
      /** Nested agent run rejected by the custom handler. */
      agentRunId: string;
    })
  | (HeartbeatTaskExecutionOutcomeBase & { kind: 'failed' })
  | (HeartbeatTaskExecutionOutcomeBase & {
      kind: 'cancelled';
      /** Bounded, operator-provided reason for targeted cancellation. */
      reason?: string;
    });

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
  runRequest?: HeartbeatTaskRunRequest;
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
  outcome: HeartbeatTaskExecutionOutcome & { kind: 'skipped' | 'cancelled' | 'retry' | 'blocked' };
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
  | { status: 'not-due'; task: HeartbeatTask }
  | { status: 'busy' | 'disabled' | 'not-found' };

/**
 * `due` makes the durable store re-check scheduler eligibility atomically with
 * the claim. `any` is reserved for explicit operator-triggered "run now"
 * paths that intentionally ignore the stored schedule.
 */
export type HeartbeatTaskClaimMode = 'any' | 'due';

export type HeartbeatTaskExecutionWriteResult =
  | { status: 'saved'; task: HeartbeatTask; record?: HeartbeatTaskRunRecord }
  | { status: 'claim-lost' }
  | { status: 'cancelled' };

export type HeartbeatTaskRecoveryResult = {
  task: HeartbeatTask;
  recovery: HeartbeatTaskRecovery;
};

export type HeartbeatTaskStore = {
  listTasks: () => Promise<HeartbeatTask[]>;
  saveTask: (task: HeartbeatTask) => Promise<void>;
  loadCheckpoint: (task: HeartbeatTask) => Promise<AgentLoopCheckpoint | undefined>;
  saveCheckpoint: (task: HeartbeatTask, checkpoint: AgentLoopCheckpoint) => Promise<void>;
  requestTaskRun: (
    taskId: string,
    options?: RequestHeartbeatTaskRunOptions,
  ) => Promise<HeartbeatTaskRunRequestResult>;
  subscribeToRunRequests?: (listener: (request: HeartbeatTaskRunRequestSignal) => void) => () => void;
  claimTaskExecution: (input: {
    taskId: string;
    execution: HeartbeatTaskExecution;
    loadedCheckpoint: boolean;
    claimedAt: Date;
    claimMode?: HeartbeatTaskClaimMode;
  }) => Promise<HeartbeatTaskClaimResult>;
  completeTaskExecution: (input: {
    execution: HeartbeatTaskExecution;
    taskId: string;
    checkpoint: AgentLoopCheckpoint;
    result: AgentHeartbeatResult;
    loadedCheckpoint: boolean;
    completedAt: Date;
    signal?: AbortSignal;
  }) => Promise<HeartbeatTaskExecutionWriteResult>;
  failTaskExecution: (input: {
    execution: HeartbeatTaskExecution;
    taskId: string;
    error: unknown;
    failedAt: Date;
    retryMs: number;
    signal?: AbortSignal;
  }) => Promise<HeartbeatTaskExecutionWriteResult>;
  recordTaskExecutionOutcome: (input: {
    execution: HeartbeatTaskExecution;
    taskId: string;
    kind: 'skipped' | 'cancelled' | 'retry' | 'blocked';
    summary: string;
    /** Nested agent run rejected by an explicit custom-handler outcome. */
    agentRunId?: string;
    /** Retry delay selected by an explicit custom-handler outcome. */
    retryMs?: number;
    /** Supplied only for a targeted `cancelled` outcome. */
    reason?: string;
    finishedAt: Date;
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

/**
 * Store capability required by queue- or request-driven ephemeral workers.
 * Implementations must resolve one task directly rather than scanning a global
 * task catalog; claim fencing and all settlement guarantees remain inherited
 * from `HeartbeatTaskStore`.
 */
export type HeartbeatTargetedTaskStore = HeartbeatTaskStore & {
  loadTask: (taskId: string) => Promise<HeartbeatTask | undefined>;
};

export type FileHeartbeatTaskRepositoryOptions = {
  dir: string;
};
