import type { Logger } from 'pino';
import type { AutonomyEvaluation } from '@/core/approvals/autonomy/index.js';
import type { ToolApprovalDecision, ToolApprovalPolicy } from '@/core/approvals/types.js';
import { HeddleEventType } from '@/core/event-types.js';
import type {
  ConversationAssistantCommentaryActivity,
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
import type { AgentModelContextRecovery } from '@/core/agent/index.js';
import type { MemoryToolMode } from '@/core/memory/tool-mode.js';
import type { ToolToolkit } from '@/core/tools/index.js';

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
  | ConversationAssistantCommentaryActivity
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

export type AgentLoopEventListener = (
  event: AgentLoopEvent,
) => void | Promise<void>;

export type RunAgentLoopOptions = {
  /**
   * Optional host-preallocated identity for this run. Omit it to preserve the
   * runtime's generated-ID behavior.
   */
  runId?: string;
  goal: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  apiKey?: string;
  apiKeyProvider?: LlmProvider | 'explicit';
  credential?: RuntimeProviderCredential;
  /** Optional credential store independent from runtime state/checkpoint roots. */
  credentialStorePath?: string;
  preferApiKey?: boolean;
  maxSteps?: number;
  maxToolConcurrency?: number;
  workspaceRoot?: string;
  stateDir?: string;
  memoryDir?: string;
  /** Selects the Heddle memory capabilities exposed by composed memory toolkits. */
  memoryMode?: MemoryToolMode;
  searchIgnoreDirs?: string[];
  systemContext?: string;
  history?: ChatMessage[];
  resumeFrom?: AgentLoopState | AgentLoopCheckpoint;
  llm?: LlmAdapter;
  tools?: ToolDefinition[];
  /** Construct request-scoped tools after Heddle resolves the run credential. */
  toolkits?: ToolToolkit[];
  extraTools?: ToolDefinition[];
  includeDefaultTools?: boolean;
  includePlanTool?: boolean;
  logger?: Logger;
  /** Async listeners are serialized and settled before the run settles. */
  onEvent?: AgentLoopEventListener;
  onTraceEvent?: (event: TraceEvent) => void;
  approvalPolicies?: ToolApprovalPolicy[];
  approveToolCall?: (
    call: ToolCall,
    tool: ToolDefinition,
    autonomyEvaluation?: AutonomyEvaluation,
    reason?: string,
  ) => Promise<ToolApprovalDecision>;
  shouldStop?: () => boolean;
  abortSignal?: AbortSignal;
  recoverModelContext?: AgentModelContextRecovery;
};

export type AgentLoopResult = RunResult & {
  model: string;
  provider: LlmProvider;
  workspaceRoot: string;
  state: AgentLoopState;
};
