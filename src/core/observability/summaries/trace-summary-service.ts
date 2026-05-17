import type { TraceEvent } from '@/core/types.js';
import { DEFAULT_TRACE_SUMMARIZERS } from './default-trace-summarizers.js';
import type { TraceSummarizerMap, TraceSummaryContext, TraceSummaryValue } from './types.js';

/**
 * Summarizes trace events into durable evidence strings for turn/session
 * records. It owns event summarization policy, not live host status rendering.
 */
export class TraceSummaryService {
  private static readonly defaultService = new TraceSummaryService();

  private readonly summarizers: TraceSummarizerMap;

  constructor(summarizers: TraceSummarizerMap = {}) {
    this.summarizers = { ...DEFAULT_TRACE_SUMMARIZERS, ...summarizers };
  }

  static default(): TraceSummaryService {
    return TraceSummaryService.defaultService;
  }

  summarizeEvent(event: TraceEvent, context: TraceSummaryContext): string[] {
    const handler = this.summarizers[event.type] as ((event: TraceEvent, context: TraceSummaryContext) => TraceSummaryValue) | undefined;
    return TraceSummaryService.normalizeSummary(handler?.(event, context));
  }

  summarizeTrace(trace: TraceEvent[]): string[] {
    return trace.flatMap((event, index) => this.summarizeEvent(event, { trace, index }));
  }

  countAssistantSteps(trace: TraceEvent[]): number {
    return trace.filter((event) => event.type === 'assistant.turn').length;
  }

  private static normalizeSummary(summary: TraceSummaryValue): string[] {
    if (Array.isArray(summary)) {
      return summary;
    }

    return summary ? [summary] : [];
  }
}
