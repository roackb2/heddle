import type { Logger } from 'pino';
import type { LlmAdapter, ChatMessage, LlmUsage } from '@/core/llm/types.js';
import type { ToolApprovalPolicy } from '@/core/approvals/types.js';
import type { ToolRegistry } from '@/core/tools/index.js';
import type { PlanItem } from '@/core/tools/toolkits/internal/update-plan.js';
import type { RunResult, ToolDefinition, ToolCall, ToolResult, TraceEvent, StopReason } from '@/core/types.js';
import type { TraceRecorder } from '@/core/trace/index.js';
import type { AgentStepBudget } from './budget/index.js';
import type { MutationState } from './mutation/index.js';

export type RunAgentOptions = {
  goal: string;
  llm: LlmAdapter;
  tools: ToolDefinition[];
  maxSteps?: number;
  workspaceRoot?: string;
  logger?: Logger;
  history?: ChatMessage[];
  systemContext?: string;
  onEvent?: (event: TraceEvent) => void;
  onAssistantStream?: (update: { step: number; text: string; done: boolean }) => void;
  onToolCalling?: (call: ToolCall, step: number, toolDef: ToolDefinition) => void;
  onToolCompleted?: (call: ToolCall, result: ToolResult, step: number, durationMs: number) => void;
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
  record: (event: TraceEvent) => void;
  now: () => string;
  budget: AgentStepBudget;
  seenToolCalls: Map<string, number>;
  mutation: MutationState;
  onAssistantStream?: RunAgentOptions['onAssistantStream'];
  onToolCalling?: RunAgentOptions['onToolCalling'];
  onToolCompleted?: RunAgentOptions['onToolCompleted'];
  approvalPolicies: ToolApprovalPolicy[];
  approveToolCall?: RunAgentOptions['approveToolCall'];
  shouldStop?: RunAgentOptions['shouldStop'];
  abortSignal?: AbortSignal;
  state: AgentRunState;
};

export type AgentRunStepResult = RunResult | 'continue';
