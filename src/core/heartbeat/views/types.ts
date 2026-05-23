import type { LlmUsage } from '@/core/llm/types.js';
import type { HeartbeatDecision } from '../agent/index.js';
import type { HeartbeatTask, HeartbeatTaskState, HeartbeatTaskStatus } from '../tasks/index.js';

export type HeartbeatTaskResultView = {
  decision: HeartbeatDecision;
  summary: string;
  outcome: string;
  usage?: LlmUsage;
};

export type HeartbeatTaskView = Omit<HeartbeatTask, 'state'> & {
  taskId: string;
  state: Omit<HeartbeatTaskState, 'result'> & {
    status: HeartbeatTaskStatus;
    result?: HeartbeatTaskResultView;
  };
};

export type HeartbeatRunView = {
  id: string;
  taskId: string;
  workspaceId?: string;
  runId: string;
  createdAt: string;
  task: HeartbeatTaskView;
  result: HeartbeatTaskResultView;
  loadedCheckpoint: boolean;
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
