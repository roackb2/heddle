import type { AgentLoopCheckpoint, AgentLoopEvent, AgentLoopState, RunAgentLoopOptions } from '@/core/runtime/loop/index.js';
import type { StopReason } from '@/core/types.js';

export type HeartbeatDecision = 'continue' | 'pause' | 'complete' | 'escalate';

export type HeartbeatDecisionEvent = {
  type: 'heartbeat.decision';
  runId: string;
  decision: HeartbeatDecision;
  outcome: StopReason;
  summary: string;
  timestamp: string;
};

export type HeartbeatEscalationEvent = {
  type: 'escalation.required';
  runId: string;
  task: string;
  outcome: StopReason;
  summary: string;
  step: number;
  timestamp: string;
};

export type AgentHeartbeatEvent = AgentLoopEvent | HeartbeatDecisionEvent | HeartbeatEscalationEvent;

export type HeartbeatRunnerAgentRunContext = {
  currentDateTime: string;
  intervalMs: number;
  nextRunAt?: string;
  previousRunAt?: string;
  previousRunId?: string;
};

export type RunAgentHeartbeatOptions = Omit<RunAgentLoopOptions, 'goal' | 'resumeFrom' | 'onEvent'> & {
  task: string;
  checkpoint?: AgentLoopState | AgentLoopCheckpoint;
  runContext?: HeartbeatRunnerAgentRunContext;
  onEvent?: (event: AgentHeartbeatEvent) => void;
};

export type AgentHeartbeatResult = {
  decision: HeartbeatDecision;
  summary: string;
  checkpoint: AgentLoopCheckpoint;
  state: AgentLoopState;
};
