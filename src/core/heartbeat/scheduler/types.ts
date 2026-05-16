import type { AgentLoopCheckpoint, AgentLoopState } from '@/core/runtime/loop/index.js';
import type { AgentHeartbeatResult, RunAgentHeartbeatOptions } from '../wake/index.js';
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
