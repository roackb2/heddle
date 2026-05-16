import type { LlmUsage } from '@/core/llm/types.js';
import type { HeartbeatDecision } from '../wake/index.js';
import type { HeartbeatTask, HeartbeatTaskRuntime, HeartbeatTaskSchedule, HeartbeatTaskState, HeartbeatTaskStatus } from '../tasks/index.js';

export type HeartbeatTaskView = HeartbeatTask & HeartbeatTaskSchedule & HeartbeatTaskRuntime & HeartbeatTaskState & {
  taskId: string;
  status: HeartbeatTaskStatus;
  lastRunAt?: string;
  lastRunId?: string;
  decision?: HeartbeatDecision;
  summary?: string;
  outcome?: string;
  usage?: LlmUsage;
};

export type HeartbeatRunView = HeartbeatTaskView & {
  id: string;
  runId: string;
  createdAt: string;
  decision: HeartbeatDecision;
  outcome: string;
  summary: string;
  loadedCheckpoint: boolean;
  usage?: LlmUsage;
};

export type LucidAgentStatus = 'running' | 'paused' | 'asleep' | 'terminated' | 'blocked' | 'failed';

export type LucidAgentStatusNotification = {
  agent_id: string;
  status: string;
  timestamp: string;
};

export type LucidAgentProgressNotification = {
  agent_id: string;
  progress: string;
  timestamp: string;
};

export type LucidAgentResponseNotification = {
  agent_id: string;
  response: string;
  timestamp: string;
};

export type LucidAgentMessage =
  | { event: 'agent_status'; data: { status: LucidAgentStatusNotification } }
  | { event: 'agent_progress'; data: { progress: LucidAgentProgressNotification } }
  | { event: 'agent_response'; data: { response: LucidAgentResponseNotification } };

export type LucidAdapterOptions = {
  taskIdToAgentId?: (taskId: string) => string;
};
