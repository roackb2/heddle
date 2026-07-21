import type { LlmProvider, LlmUsage } from '@/core/llm/types.js';
import { HeddleEventType } from '@/core/event-types.js';
import type { AgentPlanState } from '@/core/agent/planning/index.js';
import type { RunFailure, StopReason, ToolCall, ToolResult } from '@/core/types.js';

export type ConversationActivityCorrelation = {
  runId?: string;
  step?: number;
  timestamp?: string;
};

export type ConversationToolSummary = {
  kind: 'tool-summary';
  summary: string;
};

export type ConversationToolFallbackSummary = {
  kind: 'tool-fallback-summary';
  fromSummary: string;
  toSummary: string;
};

export type ConversationCyberLoopMetricsSummary = {
  kind: 'cyberloop-metrics';
  metrics: string;
};

export type ConversationActivityDerived =
  | ConversationToolSummary
  | ConversationToolFallbackSummary
  | ConversationCyberLoopMetricsSummary;

export type ConversationLoopStartedActivity = {
  source: 'agent-loop';
  type: typeof HeddleEventType.loopStarted;
  runId: string;
  goal: string;
  model: string;
  provider: LlmProvider;
  workspaceRoot: string;
  resumedFromCheckpoint?: string;
  timestamp: string;
};

export type ConversationAssistantStreamActivity = {
  source: 'agent-loop';
  type: typeof HeddleEventType.assistantStream;
  runId: string;
  step: number;
  text: string;
  done: boolean;
  timestamp: string;
};

/**
 * Assistant-authored, user-facing progress narration emitted during a turn.
 * This is distinct from provider reasoning summaries and the final response.
 */
export type ConversationAssistantCommentaryActivity = {
  source: 'agent-loop';
  type: typeof HeddleEventType.assistantCommentary;
  runId: string;
  step: number;
  messageId: string;
  text: string;
  done: boolean;
  timestamp: string;
};

/**
 * Provider-generated reasoning summary intended for user-visible progress.
 * This is not hidden model chain-of-thought or assistant response draft text.
 */
export type ConversationReasoningSummaryActivity = {
  source: 'agent-loop';
  type: typeof HeddleEventType.reasoningSummary;
  runId: string;
  step: number;
  text: string;
  done: boolean;
  timestamp: string;
};

export type ConversationToolApprovalRequestedActivity = {
  source: 'agent-loop';
  type: typeof HeddleEventType.toolApprovalRequested;
  runId: string;
  step: number;
  call: ToolCall;
  timestamp: string;
  derived?: ConversationActivityDerived;
};

export type ConversationToolApprovalResolvedActivity = {
  source: 'agent-loop';
  type: typeof HeddleEventType.toolApprovalResolved;
  runId: string;
  step: number;
  call: ToolCall;
  approved: boolean;
  reason?: string;
  timestamp: string;
  derived?: ConversationActivityDerived;
};

export type ConversationToolFallbackActivity = {
  source: 'agent-loop';
  type: typeof HeddleEventType.toolFallback;
  runId: string;
  step: number;
  fromCall: ToolCall;
  toCall: ToolCall;
  reason: string;
  timestamp: string;
  derived?: ConversationActivityDerived;
};

export type ConversationToolCallingActivity = {
  source: 'agent-loop';
  type: typeof HeddleEventType.toolCalling;
  runId: string;
  step: number;
  tool: string;
  toolCallId: string;
  input: unknown;
  requiresApproval: boolean;
  timestamp: string;
  derived?: ConversationActivityDerived;
};

export type ConversationToolCompletedActivity = {
  source: 'agent-loop';
  type: typeof HeddleEventType.toolCompleted;
  runId: string;
  step: number;
  tool: string;
  toolCallId: string;
  result: ToolResult;
  durationMs: number;
  timestamp: string;
};

export type ConversationPlanUpdatedActivity = AgentPlanState & {
  source: 'agent-loop';
  type: typeof HeddleEventType.planUpdated;
  runId: string;
  step: number;
  timestamp: string;
};

export type ConversationLoopFinishedActivity = {
  source: 'agent-loop';
  type: typeof HeddleEventType.loopFinished;
  runId: string;
  outcome: StopReason;
  summary: string;
  failure?: RunFailure;
  usage?: LlmUsage;
  timestamp: string;
};

export type ConversationAgentLoopActivity =
  | ConversationLoopStartedActivity
  | ConversationAssistantStreamActivity
  | ConversationAssistantCommentaryActivity
  | ConversationReasoningSummaryActivity
  | ConversationToolApprovalRequestedActivity
  | ConversationToolApprovalResolvedActivity
  | ConversationToolFallbackActivity
  | ConversationToolCallingActivity
  | ConversationToolCompletedActivity
  | ConversationPlanUpdatedActivity
  | ConversationLoopFinishedActivity;

export type ConversationCompactionRunningActivity = {
  source: 'compaction';
  type: typeof HeddleEventType.compactionRunning;
  status: 'running';
  archivePath?: string;
};

export type ConversationCompactionFinishedActivity = {
  source: 'compaction';
  type: typeof HeddleEventType.compactionFinished;
  status: 'finished';
  archivePath?: string;
  summaryPath?: string;
};

export type ConversationCompactionFailedActivity = {
  source: 'compaction';
  type: typeof HeddleEventType.compactionFailed;
  status: 'failed';
  archivePath?: string;
  summaryPath?: string;
  error?: string;
};

export type ConversationCompactionActivity =
  | ConversationCompactionRunningActivity
  | ConversationCompactionFinishedActivity
  | ConversationCompactionFailedActivity;

export type ConversationCompactionStatus = ConversationCompactionActivity;

export type ConversationDirectShellStartedActivity = {
  source: 'direct-shell';
  type: typeof HeddleEventType.directShellStarted;
  runId: string;
  command: string;
  tool: 'run_shell_inspect' | 'run_shell_mutate';
  timestamp: string;
};

export type ConversationDirectShellCompletedActivity = {
  source: 'direct-shell';
  type: typeof HeddleEventType.directShellCompleted;
  runId: string;
  command: string;
  tool: 'run_shell_inspect' | 'run_shell_mutate';
  result: ToolResult;
  durationMs: number;
  timestamp: string;
};

export type ConversationDirectShellActivity =
  | ConversationDirectShellStartedActivity
  | ConversationDirectShellCompletedActivity;

export type ConversationActivity = ConversationAgentLoopActivity | ConversationCompactionActivity | ConversationDirectShellActivity;

export type ConversationActivityOf<Type extends ConversationActivity['type']> = Extract<
  ConversationActivity,
  { type: Type }
>;

export type ConversationActivityHandlerMap<Context, Result = void> = {
  [Type in ConversationActivity['type']]?: (activity: ConversationActivityOf<Type>, context: Context) => Result;
};

export type ToolSummaryOptions = {
  maxChars?: number;
};

export type ToolResultSummaryOptions = ToolSummaryOptions & {
  tool: string;
  result: ToolResult;
};

export type ToolCallSummaryInput = Pick<ToolCall, 'tool' | 'input'>;
