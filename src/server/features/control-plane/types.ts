import type { HeartbeatRunView, HeartbeatTaskView } from '../../../runtime/heartbeat-views.js';

export type ChatSessionView = {
  id: string;
  name: string;
  createdAt?: string;
  updatedAt?: string;
  model?: string;
  driftEnabled?: boolean;
  messageCount: number;
  turnCount: number;
  lastPrompt?: string;
  lastOutcome?: string;
  lastSummary?: string;
  context?: {
    estimatedHistoryTokens?: number;
    estimatedRequestTokens?: number;
    lastRunInputTokens?: number;
    lastRunOutputTokens?: number;
    lastRunTotalTokens?: number;
  };
};

export type ControlPlaneState = {
  workspaceRoot: string;
  stateRoot: string;
  sessions: ChatSessionView[];
  heartbeat: {
    tasks: HeartbeatTaskView[];
    runs: HeartbeatRunView[];
  };
};
