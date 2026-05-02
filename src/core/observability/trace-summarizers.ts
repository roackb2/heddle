import type { TraceEvent } from '../types.js';
import { truncate } from '../utils/text.js';

const MAX_TOOL_CALL_SUMMARY_CHARS = 96;

export type TraceEventType = TraceEvent['type'];

export type TraceSummaryContext = {
  trace: TraceEvent[];
  index: number;
};

export type TraceEventOfType<Type extends TraceEventType> = Extract<TraceEvent, { type: Type }>;

export type TraceSummarizer<Type extends TraceEventType = TraceEventType> = (
  event: TraceEventOfType<Type>,
  context: TraceSummaryContext,
) => string | string[] | undefined;

export type TraceSummarizerMap = {
  [Type in TraceEventType]?: TraceSummarizer<Type>;
};

export type TraceSummarizerRegistry = {
  summarizeEvent: (event: TraceEvent, context: TraceSummaryContext) => string[];
  summarizeTrace: (trace: TraceEvent[]) => string[];
  countAssistantSteps: (trace: TraceEvent[]) => number;
};

export const DEFAULT_TRACE_SUMMARIZERS: TraceSummarizerMap = {
  'run.started': () => undefined,
  'assistant.turn': (event) => [
    ...(event.diagnostics?.rationale ? [`reasoning: ${truncate(event.diagnostics.rationale, 140)}`] : []),
    event.requestedTools ?
      `assistant requested ${event.toolCalls?.map((call) => summarizeToolCall(call.tool, call.input)).join(', ')}`
    : 'assistant answered',
  ],
  'host.warning': (event) => [`host warning ${event.code}: ${truncate(event.message, 140)}`],
  'tool.approval_requested': (event) => [`approval requested for ${summarizeToolCall(event.call.tool, event.call.input)}`],
  'tool.approval_resolved': (event) => [
    `approval ${event.approved ? 'granted' : 'denied'} for ${summarizeToolCall(event.call.tool, event.call.input)}${event.reason ? ` (${truncate(event.reason, 80)})` : ''}`,
  ],
  'tool.fallback': (event) => [
    `fallback ${summarizeToolCall(event.fromCall.tool, event.fromCall.input)} -> ${summarizeToolCall(event.toCall.tool, event.toCall.input)} (${event.reason})`,
  ],
  'tool.call': (event) => [`tool call ${summarizeToolCall(event.call.tool, event.call.input)}`],
  'tool.result': (event) => [`tool result ${event.tool}: ${event.result.ok ? 'ok' : event.result.error ?? 'error'}`],
  'memory.candidate_recorded': (event) => [`memory candidate recorded: ${event.candidateId}`],
  'memory.checkpoint_skipped': (event) => [`memory checkpoint skipped: ${truncate(event.rationale, 100)}`],
  'memory.maintenance_started': (event) => [`memory maintenance started: ${event.candidateIds.join(', ')}`],
  'memory.maintenance_finished': (event) => [`memory maintenance finished: ${event.outcome}`],
  'memory.maintenance_failed': (event) => [`memory maintenance failed: ${event.error}`],
  'cyberloop.annotation': () => undefined,
  'run.finished': (event) => [`run finished: ${event.outcome}`],
};

export function createTraceSummarizerRegistry(summarizers: TraceSummarizerMap = {}): TraceSummarizerRegistry {
  const handlers = { ...DEFAULT_TRACE_SUMMARIZERS, ...summarizers };
  const summarizeEvent = (event: TraceEvent, context: TraceSummaryContext): string[] => {
    const summary = summarizeWithHandler(handlers, event, context);
    return normalizeSummary(summary);
  };

  return {
    summarizeEvent,
    summarizeTrace: (trace) => trace.flatMap((event, index) => summarizeEvent(event, { trace, index })),
    countAssistantSteps(trace) {
      return trace.filter((event) => event.type === 'assistant.turn').length;
    },
  };
}

const DEFAULT_TRACE_SUMMARIZER_REGISTRY = createTraceSummarizerRegistry();

export function summarizeTrace(trace: TraceEvent[]): string[] {
  return DEFAULT_TRACE_SUMMARIZER_REGISTRY.summarizeTrace(trace);
}

export function countAssistantSteps(trace: TraceEvent[]): number {
  return DEFAULT_TRACE_SUMMARIZER_REGISTRY.countAssistantSteps(trace);
}

function summarizeWithHandler(
  handlers: TraceSummarizerMap,
  event: TraceEvent,
  context: TraceSummaryContext,
): string | string[] | undefined {
  const handler = handlers[event.type] as ((event: TraceEvent, context: TraceSummaryContext) => string | string[] | undefined) | undefined;
  return handler?.(event, context);
}

function normalizeSummary(summary: string | string[] | undefined): string[] {
  if (Array.isArray(summary)) {
    return summary;
  }

  return summary ? [summary] : [];
}

function summarizeToolCall(tool: string, input: unknown): string {
  const shellCommand = extractShellCommand(input);
  if (shellCommand) {
    return `${tool} (${truncate(shellCommand, MAX_TOOL_CALL_SUMMARY_CHARS)})`;
  }

  const path = extractPathField(input);
  if (path) {
    return `${tool} (${truncate(path, MAX_TOOL_CALL_SUMMARY_CHARS)})`;
  }

  return tool;
}

function extractShellCommand(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const command = (value as { command?: unknown }).command;
  return typeof command === 'string' && command.trim() ? command.trim() : undefined;
}

function extractPathField(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const path = (value as { path?: unknown }).path;
  return typeof path === 'string' && path.trim() ? path.trim() : undefined;
}
