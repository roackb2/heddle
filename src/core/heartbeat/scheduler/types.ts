import type { AgentLoopCheckpoint, AgentLoopState } from '@/core/runtime/loop/index.js';
import type { LlmProvider } from '@/core/llm/types.js';
import type { AgentHeartbeatEvent, AgentHeartbeatResult, RunAgentHeartbeatOptions } from '../agent/index.js';
import type { HeartbeatTask, HeartbeatTaskRunRecord, HeartbeatTaskStatus, HeartbeatTaskStore } from '../tasks/index.js';

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
      type: 'heartbeat.task.agent_event';
      taskId: string;
      event: AgentHeartbeatEvent;
      timestamp: string;
    }
  | {
      type: 'heartbeat.task.finished';
      taskId: string;
      record: HeartbeatTaskRunRecord;
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
  runner?: HeartbeatTaskRunner;
  runtime?: HeartbeatTaskRunnerRuntimeOptions;
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

export type HeartbeatSchedulerHandle = {
  stop: () => void;
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
  pollIntervalMs?: number;
  onEvent?: (event: HeartbeatSchedulerEvent) => void;
  onError?: (error: unknown) => void;
};
