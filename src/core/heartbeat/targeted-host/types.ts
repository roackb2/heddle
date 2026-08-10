import type {
  CancelHeartbeatTaskOptions,
  HeartbeatTaskCancellationResult,
  HeartbeatTaskHandler,
  RunHeartbeatTaskOptions,
  RunHeartbeatTaskResult,
  StopHeartbeatSchedulerOptions,
} from '../scheduler/index.js';
import type {
  HeartbeatTargetedTaskStore,
  HeartbeatTaskRunRequestSignal,
} from '../tasks/index.js';

/** One process-local delivery of an already persisted heartbeat task request. */
export type HeartbeatTargetedTaskInvocation = {
  taskId: string;
  invocationId: string;
  runRequestGeneration?: number;
  signal: AbortSignal;
};

/** Replaceable delivery target used by the low-volume dispatcher. */
export interface HeartbeatTargetedTaskInvocationTarget {
  invoke(
    invocation: HeartbeatTargetedTaskInvocation,
  ): Promise<RunHeartbeatTaskResult>;
}

export type HeartbeatTargetedTaskDispatchDecision =
  | { kind: 'complete-delivery' }
  | { kind: 'retry-transiently'; delayMs: number }
  | { kind: 'wait-for-durable-schedule' };

export type HeartbeatTargetedTaskDispatchOutcome = {
  taskId: string;
  invocationId: string;
  runRequestGeneration?: number;
  result: RunHeartbeatTaskResult;
  decision: HeartbeatTargetedTaskDispatchDecision;
};

export type HeartbeatTargetedTaskDispatchError = {
  phase: 'admission-gate' | 'poll' | 'invoke';
  error: unknown;
  taskId?: string;
  invocationId?: string;
};

export type HeartbeatTargetedTaskNotificationResult = {
  taskId: string;
  status: 'queued' | 'coalesced' | 'not-managed' | 'not-running';
};

export type HeartbeatTargetedTaskLocalCancellationResult = {
  taskId: string;
  disposition: 'cancelled' | 'not-active';
  invocationId?: string;
  result?: RunHeartbeatTaskResult;
};

type HeartbeatTargetedTaskCatalog = Pick<
  HeartbeatTargetedTaskStore,
  'listTasks'
>;

export type HeartbeatTargetedTaskDispatcherOptions = {
  store: HeartbeatTargetedTaskCatalog;
  target: HeartbeatTargetedTaskInvocationTarget;
  /** Omit to manage every task visible through this store namespace. */
  taskIdPrefix?: string;
  pollIntervalMs: number;
  maxConcurrentInvocations: number;
  /** Cooperative wall-clock bound for one invocation. */
  invocationTimeoutMs: number;
  /** Retry delay only for transient ownership contention. */
  contentionRetryMs?: number;
  /** Durable product/operator gate. Errors fail closed. */
  isAdmissionEnabled?: () => boolean | Promise<boolean>;
  now?: () => Date;
  createInvocationId?: (
    taskId: string,
    runRequestGeneration: number | undefined,
  ) => string;
  onOutcome?: (outcome: HeartbeatTargetedTaskDispatchOutcome) => void;
  onError?: (error: HeartbeatTargetedTaskDispatchError) => void;
};

export type StartHeartbeatTargetedTaskDispatcherOptions = {
  admissionPaused?: boolean;
};

export type StopHeartbeatTargetedTaskDispatcherOptions = {
  cancelActive?: boolean;
};

type HeartbeatTargetedTaskWorkerExecutionOptions = Omit<
  RunHeartbeatTaskOptions,
  | 'taskId'
  | 'store'
  | 'executionOwnerId'
  | 'signal'
  | 'handler'
  | 'runner'
>;

export type HeartbeatTargetedTaskWorkerOptions =
  HeartbeatTargetedTaskWorkerExecutionOptions & {
    store: HeartbeatTargetedTaskStore;
    handler: HeartbeatTaskHandler;
  };

type HeartbeatTargetedTaskHostDispatcherOptions = Omit<
  HeartbeatTargetedTaskDispatcherOptions,
  'store' | 'target'
>;

export type HeartbeatTargetedTaskHostOptions =
  HeartbeatTargetedTaskHostDispatcherOptions & {
    store: HeartbeatTargetedTaskStore;
    createTarget: (
      handler: HeartbeatTaskHandler,
    ) => HeartbeatTargetedTaskInvocationTarget;
    /** Must be shorter than the store's execution lease. */
    recoveryIntervalMs: number;
    recoveryOwnerId?: string;
    onRecoveryError?: (error: unknown) => void;
  };

export type StartHeartbeatTargetedTaskHostInput = {
  handler: HeartbeatTaskHandler;
  admissionEnabled?: boolean;
};

export interface HeartbeatTargetedTaskHostHandle {
  start(input: StartHeartbeatTargetedTaskHostInput): void;
  notify(
    request: HeartbeatTaskRunRequestSignal,
  ): HeartbeatTargetedTaskNotificationResult | undefined;
  cancelTask(
    taskId: string,
    options: CancelHeartbeatTaskOptions,
  ): Promise<HeartbeatTaskCancellationResult>;
  pause(options: CancelHeartbeatTaskOptions): Promise<void>;
  resume(): void;
  stop(options?: StopHeartbeatSchedulerOptions): Promise<void>;
}
