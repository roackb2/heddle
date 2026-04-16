import type { AgentLoopEvent } from '../../../core/runtime/agent-loop.js';
import type { HeartbeatRunView, HeartbeatTaskView } from '../../../core/runtime/heartbeat-views.js';

export type ChatSessionView = {
  id: string;
  name: string;
  createdAt?: string;
  updatedAt?: string;
  model?: string;
  driftEnabled?: boolean;
  driftLevel?: 'unknown' | 'low' | 'medium' | 'high';
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

export type ChatSessionMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  isStreaming?: boolean;
  isPending?: boolean;
};

export type ChatTurnView = {
  id: string;
  prompt: string;
  outcome: string;
  summary: string;
  steps: number;
  traceFile: string;
  events: string[];
};

export type CommandEvidenceView = {
  tool: string;
  command: string;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
};

export type ApprovalEventView = {
  tool: string;
  command?: string;
  approved: boolean;
  reason?: string;
  timestamp?: string;
};

export type ChatTurnReview = {
  traceFile: string;
  diffExcerpt?: string;
  finalSummary?: string;
  reviewCommands: CommandEvidenceView[];
  verificationCommands: CommandEvidenceView[];
  mutationCommands: CommandEvidenceView[];
  approvals: ApprovalEventView[];
};

export type ChatSessionDetail = ChatSessionView & {
  messages: ChatSessionMessage[];
  turns: ChatTurnView[];
  lastContinuePrompt?: string;
};

export type ControlPlanePendingApproval = {
  tool: string;
  callId: string;
  input: unknown;
  requestedAt: string;
};

export type ControlPlaneSessionLiveEvent = {
  sessionId: string;
  timestamp: string;
  event: AgentLoopEvent;
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
