import type { AgentLoopCheckpoint, AgentLoopState } from '@/core/runtime/loop/index.js';
import type { LlmProvider } from '@/core/llm/types.js';
import type { AgentHeartbeatEvent, AgentHeartbeatResult, RunAgentHeartbeatOptions } from '../agent/index.js';
import type {
  HeartbeatTask,
  HeartbeatTaskAgentRunRecord,
  HeartbeatTaskNonAgentRunRecord,
  HeartbeatTaskRunRecord,
  HeartbeatTaskStatus,
  HeartbeatTaskStore,
} from '../tasks/index.js';

export type HeartbeatSchedulerEvent =
  | { type: 'heartbeat.scheduler.started'; timestamp: string }
  | { type: 'heartbeat.scheduler.stopped'; reason: 'aborted' | 'completed' | 'error'; timestamp: string }
  | { type: 'heartbeat.scheduler.awakened'; taskIds: string[]; timestamp: string }
  | { type: 'heartbeat.task.due'; taskId: string; timestamp: string }
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
      record: HeartbeatTaskNonAgentRunRecord & { outcome: { kind: 'cancelled' } };
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
};

export type HeartbeatHandlerOutcome = {
  kind: 'skipped';
  summary: string;
};

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

export type HeartbeatSchedulerHandle = {
  stop: (options?: StopHeartbeatSchedulerOptions) => Promise<void>;
};

export type StartHeartbeatSchedulerOptions = {
  workspaceRoot: string;
  stateRoot: string;
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
  onEvent?: (event: HeartbeatSchedulerEvent) => void;
  onError?: (error: unknown) => void;
};
