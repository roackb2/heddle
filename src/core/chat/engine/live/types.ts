import type { AgentLoopEvent } from '@/core/runtime/loop/index.js';
import type { ToolCall, ToolResult, TraceEvent } from '@/core/types.js';
import type { ConversationCompactionStatus } from '../compaction/index.js';
export type { ConversationCompactionStatus } from '../compaction/index.js';

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

type TraceActivity = {
  [Type in TraceEvent['type']]: {
    source: 'trace';
    type: Type;
    event: Extract<TraceEvent, { type: Type }>;
    correlation: ConversationActivityCorrelation;
    derived?: ConversationActivityDerived;
  };
}[TraceEvent['type']];

export type ConversationAgentLoopActivityEvent = Exclude<
  AgentLoopEvent,
  { type: 'trace' | 'checkpoint.saved' | 'loop.resumed' }
>;

type AgentLoopActivity = {
  [Type in ConversationAgentLoopActivityEvent['type']]: {
    source: 'agent-loop';
    type: Type;
    event: Extract<ConversationAgentLoopActivityEvent, { type: Type }>;
    correlation: ConversationActivityCorrelation;
    derived?: ConversationActivityDerived;
  };
}[ConversationAgentLoopActivityEvent['type']];

type CompactionActivity = {
  [Status in ConversationCompactionStatus['status']]: {
    source: 'compaction';
    type: `compaction.${Status}`;
    event: ConversationCompactionStatus & { status: Status };
  };
}[ConversationCompactionStatus['status']];

export type ConversationActivity = TraceActivity | AgentLoopActivity | CompactionActivity;

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
