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

/** Provider-neutral admission scope consulted by the final durable task claim. */
export type HeartbeatAdmissionTarget =
  | { kind: 'namespace' }
  | { kind: 'group'; groupId: string };

/** Binary claim-time projection of an adapter's durable admission lifecycle. */
export type HeartbeatAdmissionDecision = 'ready' | 'closed';

/**
 * Operator-facing control port for durable heartbeat admission.
 *
 * Implementations must serialize decision changes with `claimTaskExecution`.
 * An absent namespace decision is `ready` for legacy ungrouped tasks, while an
 * absent assigned-group decision is `closed` so partially reconciled grouped
 * tasks fail closed. Admission governs fresh logical work. An exact durable
 * recovery continuation may bypass closed admission; use explicit host pause,
 * drain, or cancellation when no execution may proceed.
 */
export interface HeartbeatTaskAdmissionControl {
  readAdmissionDecision(target: HeartbeatAdmissionTarget): Promise<HeartbeatAdmissionDecision>;
  setAdmissionDecision(
    target: HeartbeatAdmissionTarget,
    decision: HeartbeatAdmissionDecision,
  ): Promise<void>;
}

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
  interruptedRunRequestGeneration?: number;
  recoveredAt: string;
  reason: HeartbeatTaskRecoveryReason;
  /** Missing on legacy diagnostic records, which never authorize a replacement. */
  replacementStatus?: 'pending' | 'claimed';
  /** Set atomically when one exact replacement execution consumes this recovery. */
  replacementExecutionId?: string;
  replacementClaimedAt?: string;
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
  /** Optional opaque admission group checked in addition to the store namespace. */
  admissionGroupId?: string;
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
  | { status: 'admission-closed'; target: HeartbeatAdmissionTarget }
  | { status: 'busy' | 'disabled' | 'not-found' };

/**
 * `due` makes the durable store re-check scheduler eligibility atomically with
 * the claim. `any` is reserved for explicit operator-triggered "run now"
 * paths that intentionally ignore the stored schedule. Both modes are fresh
 * logical work and require ready admission.
 *
 * `recovery` is only for the exact unconsumed recovery identified by
 * `recoveryOfExecutionId`. It still requires an enabled, due, non-running task,
 * but may bypass closed namespace/group admission because it continues work
 * admitted by the interrupted execution. The claim must consume that recovery
 * marker atomically and must not consume a newer run-request generation.
 */
export type HeartbeatTaskClaimMode = 'any' | 'due' | 'recovery';

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
  /**
   * Final durable admission authority. The claim must atomically recheck task
   * enablement, claim-mode schedule eligibility, active ownership, namespace
   * admission, and the task's optional assigned-group admission, or atomically
   * match and consume the exact pending recovery allowed to bypass both scopes.
   */
  claimTaskExecution: (input: {
    taskId: string;
    execution: HeartbeatTaskExecution;
    loadedCheckpoint: boolean;
    claimedAt: Date;
    claimMode?: HeartbeatTaskClaimMode;
    /** Required only for `claimMode: 'recovery'`; rejected on every other mode. */
    recoveryOfExecutionId?: string;
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
