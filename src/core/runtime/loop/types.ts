import type { Logger } from 'pino';
import type { AutonomyEvaluation } from '@/core/approvals/autonomy/index.js';
import type { ToolApprovalDecision, ToolApprovalPolicy } from '@/core/approvals/types.js';
import { HeddleEventType } from '@/core/event-types.js';
import type {
  ConversationAssistantStreamActivity,
  ConversationLoopFinishedActivity,
  ConversationLoopStartedActivity,
  ConversationToolApprovalRequestedActivity,
  ConversationToolApprovalResolvedActivity,
  ConversationToolFallbackActivity,
  ConversationToolCallingActivity,
  ConversationToolCompletedActivity,
  ConversationPlanUpdatedActivity,
  ConversationReasoningSummaryActivity,
} from '@/core/live/index.js';
import type { ChatMessage, LlmAdapter, LlmProvider, LlmUsage, ReasoningEffort } from '@/core/llm/types.js';
import type { RunFailure, RunResult, StopReason, ToolCall, ToolDefinition, TraceEvent } from '@/core/types.js';
import type { RuntimeProviderCredential } from '@/core/runtime/credentials/index.js';

export type AgentLoopStatus = 'finished';

export type AgentLoopState = {
  status: AgentLoopStatus;
  runId: string;
  goal: string;
  model: string;
  provider: LlmProvider;
  workspaceRoot: string;
  startedAt: string;
  finishedAt: string;
  outcome: StopReason;
  summary: string;
  failure?: RunFailure;
  usage?: LlmUsage;
  transcript: ChatMessage[];
  trace: TraceEvent[];
};

export type AgentLoopCheckpoint = {
  version: 1;
  runId: string;
  createdAt: string;
  state: AgentLoopState;
};

export type AgentLoopEvent =
  | ConversationLoopStartedActivity
  | {
      type: typeof HeddleEventType.loopResumed;
      runId: string;
      fromCheckpoint: string;
      priorTraceEvents: number;
      timestamp: string;
    }
  | ConversationAssistantStreamActivity
  | ConversationReasoningSummaryActivity
  | ConversationToolApprovalRequestedActivity
  | ConversationToolApprovalResolvedActivity
  | ConversationToolFallbackActivity
  | ConversationToolCallingActivity
  | ConversationToolCompletedActivity
  | ConversationPlanUpdatedActivity
  | {
      type: typeof HeddleEventType.trace;
      runId: string;
      event: TraceEvent;
      timestamp: string;
    }
  | {
      type: typeof HeddleEventType.checkpointSaved;
      runId: string;
      checkpoint: AgentLoopCheckpoint;
      step: number;
      timestamp: string;
    }
  | ConversationLoopFinishedActivity & {
      state: AgentLoopState;
    };

export type RunAgentLoopOptions = {
  goal: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  apiKey?: string;
  credential?: RuntimeProviderCredential;
  maxSteps?: number;
  workspaceRoot?: string;
  stateDir?: string;
  memoryDir?: string;
  searchIgnoreDirs?: string[];
  systemContext?: string;
  history?: ChatMessage[];
  resumeFrom?: AgentLoopState | AgentLoopCheckpoint;
  llm?: LlmAdapter;
  tools?: ToolDefinition[];
  extraTools?: ToolDefinition[];
  includeDefaultTools?: boolean;
  includePlanTool?: boolean;
  logger?: Logger;
  onEvent?: (event: AgentLoopEvent) => void;
  onTraceEvent?: (event: TraceEvent) => void;
  approvalPolicies?: ToolApprovalPolicy[];
  approveToolCall?: (call: ToolCall, tool: ToolDefinition, autonomyEvaluation?: AutonomyEvaluation) => Promise<ToolApprovalDecision>;
  shouldStop?: () => boolean;
  abortSignal?: AbortSignal;
};

export type AgentLoopResult = RunResult & {
  model: string;
  provider: LlmProvider;
  workspaceRoot: string;
  state: AgentLoopState;
};
