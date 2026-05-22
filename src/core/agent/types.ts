import type { Logger } from 'pino';
import { HeddleEventType } from '@/core/event-types.js';
import type { LlmAdapter, ChatMessage, LlmUsage } from '@/core/llm/types.js';
import type { ConversationAgentLoopActivity } from '@/core/live/index.js';
import type { ToolApprovalPolicy } from '@/core/approvals/types.js';
import type { ToolRegistry } from '@/core/tools/index.js';
import type { PlanItem } from '@/core/tools/toolkits/internal/update-plan.js';
import type { RunResult, ToolDefinition, ToolCall, TraceEvent, StopReason } from '@/core/types.js';
import type { TraceRecorder } from '@/core/trace/index.js';
import type { AgentStepBudget } from './budget/index.js';
import type { MutationState } from './mutation/index.js';

type AgentOwnedActivity = Exclude<
  ConversationAgentLoopActivity,
  { type: typeof HeddleEventType.loopStarted | typeof HeddleEventType.loopFinished }
>;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export type AgentRunActivity = DistributiveOmit<AgentOwnedActivity, 'source' | 'runId' | 'timestamp'>;

export type AgentRunEvent =
  | AgentRunActivity
  | {
      type: typeof HeddleEventType.trace;
      event: TraceEvent;
    };

export type AgentRunLiveRecorder = {
  trace(event: TraceEvent): void;
  activity(activity: AgentRunActivity): void;
  traceActivity(args: {
    trace: TraceEvent;
    activity: AgentRunActivity;
  }): void;
};

export type RunAgentOptions = {
  goal: string;
  llm: LlmAdapter;
  tools: ToolDefinition[];
  maxSteps?: number;
  workspaceRoot?: string;
  logger?: Logger;
  history?: ChatMessage[];
  systemContext?: string;
  onEvent?: (event: AgentRunEvent) => void;
  approvalPolicies?: ToolApprovalPolicy[];
  approveToolCall?: (call: ToolCall, tool: ToolDefinition) => Promise<{ approved: boolean; reason?: string }>;
  shouldStop?: () => boolean;
  abortSignal?: AbortSignal;
};

export type AgentMemoryCheckpointState = {
  required: boolean;
  completed: boolean;
};

export type AgentReminderState = {
  postMutationFollowUpSent: boolean;
  memoryCheckpointSent: boolean;
  structuredSummarySent: boolean;
};

export type AgentPlanState = {
  explanation?: string;
  items: PlanItem[];
};

export type AgentRunState = {
  step: number;
  consecutiveErrors: number;
  executedToolCalls: number;
  outcome: StopReason;
  summary: string;
  usage?: LlmUsage;
  memoryCheckpoint: AgentMemoryCheckpointState;
  reminders: AgentReminderState;
  activePlan?: AgentPlanState;
};

export type AgentRunContext = {
  goal: string;
  maxSteps: number;
  llm: LlmAdapter;
  registry: ToolRegistry;
  workspaceRoot: string;
  log: Logger;
  messages: ChatMessage[];
  trace: TraceRecorder;
  live: AgentRunLiveRecorder;
  now: () => string;
  budget: AgentStepBudget;
  seenToolCalls: Map<string, number>;
  mutation: MutationState;
  approvalPolicies: ToolApprovalPolicy[];
  approveToolCall?: RunAgentOptions['approveToolCall'];
  shouldStop?: RunAgentOptions['shouldStop'];
  abortSignal?: AbortSignal;
  state: AgentRunState;
};

export type AgentRunStepResult = RunResult | 'continue';
