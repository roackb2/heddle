import type { TraceEvent } from '@/core/types.js';

export type TraceEventType = TraceEvent['type'];

export type TraceSummaryContext = {
  trace: TraceEvent[];
  index: number;
};

export type TraceEventOfType<Type extends TraceEventType> = Extract<TraceEvent, { type: Type }>;

export type TraceSummaryValue = string | string[] | undefined;

export type TraceSummarizer<Type extends TraceEventType = TraceEventType> = (
  event: TraceEventOfType<Type>,
  context: TraceSummaryContext,
) => TraceSummaryValue;

export type TraceSummarizerMap = {
  [Type in TraceEventType]?: TraceSummarizer<Type>;
};
