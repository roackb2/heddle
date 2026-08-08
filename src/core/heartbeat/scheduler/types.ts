import type { AgentLoopCheckpoint, AgentLoopState } from '@/core/runtime/loop/index.js';
import type { LlmProvider } from '@/core/llm/types.js';
import type { AgentHeartbeatEvent, AgentHeartbeatResult, RunAgentHeartbeatOptions } from '../agent/index.js';
export {
  DEFAULT_HEARTBEAT_HANDLER_RETRY_MS,
  MAX_HEARTBEAT_HANDLER_OUTCOME_SUMMARY_LENGTH,
  MAX_HEARTBEAT_HANDLER_RETRY_MS,
} from '../tasks/types.js';
import type {
  HeartbeatTask,
  HeartbeatTaskAgentRunRecord,
  HeartbeatTaskNonAgentRunRecord,
  HeartbeatTaskRunRecord,
  HeartbeatTaskStatus,
  HeartbeatTaskStore,
  HeartbeatTargetedTaskStore,
} from '../tasks/index.js';

export type HeartbeatSchedulerEvent =
  | { type: 'heartbeat.scheduler.started'; timestamp: string }
  | { type: 'heartbeat.scheduler.stopped'; reason: 'aborted' | 'completed' | 'error'; timestamp: string }
  | { type: 'heartbeat.scheduler.awakened'; taskIds: string[]; timestamp: string }
  | {
      type: 'heartbeat.task.due';
      taskId: string;
      timestamp: string;
      /** One-based position in the stable due-task selection order. */
      queuePosition?: number;
      /** Configured scheduler-wide task concurrency ceiling. */
      maxConcurrentTasks?: number;
      /** Active bounded-pool jobs, including this admitted task. */
      activeTasks?: number;
      /** Selected jobs still waiting for a bounded-pool slot. */
      queuedTasks?: number;
    }
  | {
      type: 'heartbeat.task.run_requested';
      taskId: string;
      generation: number;
      disposition: 'requested' | 'coalesced';
      requestedAt: string;
      reason?: string;
      timestamp: string;
    }
  | {
      type: 'heartbeat.task.run_request_claimed';
      taskId: string;
      executionId: string;
      generation: number;
      timestamp: string;
    }
  | {
      type: 'heartbeat.task.started';
      taskId: string;
      executionId: string;
      ownerId: string;
      loadedCheckpoint: boolean;
      status: HeartbeatTaskStatus;
      progress: string;
      timestamp: string;
    }
  | {
      type: 'heartbeat.task.recovered';
      taskId: string;
      interruptedExecutionId: string;
      interruptedOwnerId: string;
      reason: 'host-restart' | 'operator';
      status: HeartbeatTaskStatus;
      progress: string;
      nextRunAt?: string;
      timestamp: string;
    }
  | {
      type: 'heartbeat.task.agent_event';
      taskId: string;
      executionId: string;
      event: AgentHeartbeatEvent;
      timestamp: string;
    }
  | {
      type: 'heartbeat.task.finished';
      taskId: string;
      executionId: string;
      record: HeartbeatTaskAgentRunRecord;
      timestamp: string;
    }
  | {
      type: 'heartbeat.task.skipped';
      taskId: string;
      executionId: string;
      record: HeartbeatTaskNonAgentRunRecord & { outcome: { kind: 'skipped' } };
      timestamp: string;
    }
  | {
      type: 'heartbeat.task.cancelled';
      taskId: string;
      executionId: string;
      /** Bounded operator reason for targeted cancellation, when supplied. */
      reason?: string;
      record: HeartbeatTaskNonAgentRunRecord & { outcome: { kind: 'cancelled' } };
      timestamp: string;
    }
  | {
      type: 'heartbeat.task.retry';
      taskId: string;
      executionId: string;
      record: HeartbeatTaskNonAgentRunRecord & { outcome: { kind: 'retry' } };
      timestamp: string;
    }
  | {
      type: 'heartbeat.task.blocked';
      taskId: string;
      executionId: string;
      record: HeartbeatTaskNonAgentRunRecord & { outcome: { kind: 'blocked' } };
      timestamp: string;
    }
  | {
      type: 'heartbeat.task.failed';
      taskId: string;
      executionId: string;
      error: string;
      status: HeartbeatTaskStatus;
      progress: string;
      nextRunAt?: string;
      timestamp: string;
    };

/**
 * Per-run customization accepted by the framework-owned heartbeat agent path.
 * Credential fields are intentionally absent: Heddle resolves and refreshes
 * them inside the standard runtime boundary for every invocation.
 */
export type HeartbeatTaskRunnerAgentOptions = Partial<Pick<
  RunAgentHeartbeatOptions,
  | 'task'
  | 'model'
  | 'reasoningEffort'
  | 'maxSteps'
  | 'maxToolConcurrency'
  | 'tools'
  | 'extraTools'
  | 'includeDefaultTools'
  | 'includePlanTool'
  | 'searchIgnoreDirs'
  | 'systemContext'
  | 'history'
  | 'logger'
  | 'onTraceEvent'
  | 'onEvent'
  | 'approvalPolicies'
>>;

/**
 * Framework-owned execution handoff for custom heartbeat handlers.
 *
 * Hosts can add domain prompts and tools through `runAgent` without receiving
 * API keys, OAuth tokens, account identifiers, or stored credential records.
 * The context is valid only for the current task execution and must not be
 * persisted.
 */
export type HeartbeatExecutionContext = {
  task: HeartbeatTask;
  checkpoint?: AgentLoopCheckpoint;
  executionId: string;
  runAt: Date;
  signal: AbortSignal;
  runAgent: (options?: HeartbeatTaskRunnerAgentOptions) => Promise<AgentHeartbeatResult>;
  skip: (input: { summary: string }) => HeartbeatHandlerOutcome;
  /**
   * Rejects the completed nested agent result and schedules a bounded retry.
   * The summary is persisted and emitted to operators, so it must be concise
   * and must not include credentials, tokens, prompts, or domain payloads.
   */
  retry: (input: { summary: string; delayMs?: number }) => HeartbeatHandlerOutcome;
  /**
   * Rejects the completed nested agent result and requires explicit resume.
   * The summary is persisted and emitted to operators, so it must be concise
   * and must not include credentials, tokens, prompts, or domain payloads.
   */
  block: (input: { summary: string }) => HeartbeatHandlerOutcome;
};

export type HeartbeatHandlerOutcome =
  | { kind: 'skipped'; summary: string }
  | { kind: 'retry'; summary: string; delayMs: number; agentRunId: string }
  | { kind: 'blocked'; summary: string; agentRunId: string };

export type HeartbeatTaskHandler = (
  context: HeartbeatExecutionContext,
) => Promise<AgentHeartbeatResult | HeartbeatHandlerOutcome>;

/** @deprecated Use `HeartbeatExecutionContext`. */
export type HeartbeatTaskRunnerContext = Pick<HeartbeatExecutionContext, 'runAgent'>;

/**
 * @deprecated Use `HeartbeatTaskHandler`. This positional runner is adapted
 * through the same execution context and persistence pipeline.
 */
export type HeartbeatTaskRunner = (
  task: HeartbeatTask,
  checkpoint: AgentLoopState | AgentLoopCheckpoint | undefined,
  context: HeartbeatTaskRunnerContext,
) => Promise<AgentHeartbeatResult>;

export type HeartbeatTaskRunnerRuntimeOptions = {
  workspaceRoot?: string;
  stateDir?: string;
  memoryDir?: string;
  apiKey?: string;
  apiKeyProvider?: 'explicit' | LlmProvider;
  preferApiKey?: boolean;
  model?: string;
  maxSteps?: number;
  tools?: RunAgentHeartbeatOptions['tools'];
  includeDefaultTools?: RunAgentHeartbeatOptions['includeDefaultTools'];
  approvalPolicies?: RunAgentHeartbeatOptions['approvalPolicies'];
  searchIgnoreDirs?: string[];
  systemContext?: string;
  onAgentEvent?: RunAgentHeartbeatOptions['onEvent'];
};

export type RunDueHeartbeatTasksOptions = {
  store: HeartbeatTaskStore;
  handler?: HeartbeatTaskHandler;
  /** @deprecated Use `handler`. */
  runner?: HeartbeatTaskRunner;
  runtime?: HeartbeatTaskRunnerRuntimeOptions;
  now?: () => Date;
  onEvent?: (event: HeartbeatSchedulerEvent) => void;
  failureRetryMs?: number;
  /** Maximum independent heartbeat tasks admitted concurrently. Defaults to 1. */
  maxConcurrentTasks?: number;
  /** Stable only for this scheduler process/worker generation. */
  executionOwnerId?: string;
  /** Cancels task executions selected by this call. */
  signal?: AbortSignal;
  /** Stops selection of additional due tasks without cancelling the active one. */
  admissionSignal?: AbortSignal;
};

export type RunDueHeartbeatTasksResult = {
  checked: number;
  ran: number;
  failed: number;
  records: HeartbeatTaskRunRecord[];
};

/**
 * Machine-readable result of one claim-fenced heartbeat execution attempt.
 *
 * `settled` covers agent, skipped, and blocked outcomes. An explicit custom
 * handler retry is surfaced separately so a dispatcher can distinguish it
 * from successful settlement without inspecting record internals.
 */
export type HeartbeatTaskExecutionResult = {
  taskId: string;
  failed: boolean;
  record?: HeartbeatTaskRunRecord;
} & (
  | { status: 'settled'; executionId: string; record: HeartbeatTaskRunRecord; failed: false }
  | {
      status: 'retry';
      executionId: string;
      record: HeartbeatTaskNonAgentRunRecord & { outcome: { kind: 'retry' } };
      failed: false;
    }
  | { status: 'failed'; executionId: string; error: string; task: HeartbeatTask; failed: true }
  | { status: 'not-found' | 'disabled' | 'busy'; failed: false }
  | { status: 'not-due'; nextRunAt?: string; failed: false }
  | { status: 'claim-lost'; executionId: string; failed: false }
  | { status: 'cancelled'; executionId?: string; record?: HeartbeatTaskRunRecord; failed: false }
);

/**
 * One-shot request-driven execution for an already-routed task id.
 *
 * This path performs no global task scan, subscription, polling, or automatic
 * recovery. The host is responsible for dispatch and lease/recovery policy;
 * Heddle owns the final atomic due claim and standard execution pipeline.
 */
export type RunHeartbeatTaskOptions = Omit<
  RunDueHeartbeatTasksOptions,
  'store' | 'maxConcurrentTasks' | 'admissionSignal'
> & {
  taskId: string;
  store: HeartbeatTargetedTaskStore;
};

export type RunHeartbeatTaskResult = HeartbeatTaskExecutionResult;

export type RunHeartbeatSchedulerOptions = RunDueHeartbeatTasksOptions & {
  pollIntervalMs?: number;
  /** Stops future polling and admissions. Also cancels active work unless `executionSignal` is supplied. */
  signal?: AbortSignal;
  /** Optional distinct signal used for active work when admissions and cancellation have separate lifecycles. */
  executionSignal?: AbortSignal;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
};

export type StopHeartbeatSchedulerOptions = {
  cancelRunning?: boolean;
};

export type CancelHeartbeatTaskOptions = {
  /** Bounded, operator-facing reason. Task input must not be copied here. */
  reason: string;
};

export type HeartbeatTaskCancellationDisposition =
  | 'cancelled'
  | 'completion-won'
  | 'not-running'
  | 'not-owned'
  | 'not-found'
  | 'disabled'
  | 'blocked'
  | 'completed';

export type HeartbeatTaskCancellationResult = {
  taskId: string;
  disposition: HeartbeatTaskCancellationDisposition;
  reason: string;
  executionId?: string;
  record?: HeartbeatTaskRunRecord;
};

export type HeartbeatSchedulerHandle = {
  stop: (options?: StopHeartbeatSchedulerOptions) => Promise<void>;
  /** Cancels and awaits only a task execution owned by this scheduler handle. */
  cancelTask: (
    taskId: string,
    options: CancelHeartbeatTaskOptions,
  ) => Promise<HeartbeatTaskCancellationResult>;
};

export type StartHeartbeatSchedulerOptions = {
  workspaceRoot: string;
  /**
   * Runtime state used by framework-owned agent execution. When `store` is
   * omitted, this also locates the built-in file-backed heartbeat store.
   */
  stateRoot: string;
  /**
   * Optional host-owned heartbeat persistence adapter. The scheduler uses this
   * exact instance for recovery, wake subscriptions, claims, and settlement.
   */
  store?: HeartbeatTaskStore;
  preferApiKey?: boolean;
  model?: string;
  maxSteps?: number;
  searchIgnoreDirs?: string[];
  systemContext?: string;
  onAgentEvent?: RunAgentHeartbeatOptions['onEvent'];
  handler?: HeartbeatTaskHandler;
  /** @deprecated Use `handler`. */
  runner?: HeartbeatTaskRunner;
  pollIntervalMs?: number;
  /** Maximum independent heartbeat tasks admitted concurrently. Defaults to 1. */
  maxConcurrentTasks?: number;
  onEvent?: (event: HeartbeatSchedulerEvent) => void;
  onError?: (error: unknown) => void;
};
