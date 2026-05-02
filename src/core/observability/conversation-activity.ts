import type { AgentLoopEvent } from '../runtime/events.js';
import type { TraceEvent, ToolCall } from '../types.js';
import { truncate } from '../utils/text.js';

const DEFAULT_MAX_TOOL_SUMMARY_CHARS = 96;

export type ConversationActivityCorrelation = {
  runId?: string;
  step?: number;
  timestamp?: string;
};

export type ConversationActivity = ConversationActivityCorrelation & (
  | { type: 'loop.started' }
  | { type: 'loop.finished' }
  | { type: 'assistant.stream'; text: string; done: boolean }
  | { type: 'assistant.turn'; requestedTools: boolean; rationale?: string }
  | { type: 'tool.calling'; tool: string }
  | { type: 'tool.completed'; tool: string; durationMs?: number }
  | { type: 'run.started' }
  | { type: 'run.finished'; outcome: string }
  | { type: 'tool.approval_requested'; tool: string; toolSummary: string; call: ToolCall }
  | { type: 'tool.approval_resolved'; tool: string; toolSummary: string; approved: boolean; reason?: string; call: ToolCall }
  | { type: 'tool.fallback'; fromTool: string; toTool: string; fromSummary: string; toSummary: string; reason: string }
  | { type: 'tool.call'; toolSummary: string }
  | { type: 'tool.result'; tool: string; toolSummary: string; ok: boolean; error?: string }
  | { type: 'memory.candidate_recorded'; candidateId: string }
  | { type: 'memory.maintenance_started'; candidateCount: number }
  | { type: 'memory.maintenance_finished'; outcome: string; summary?: string }
  | { type: 'memory.maintenance_failed'; error?: string }
  | { type: 'cyberloop.annotation'; driftLevel: Exclude<Extract<TraceEvent, { type: 'cyberloop.annotation' }>['driftLevel'], 'unknown'>; metrics: string }
  | { type: 'compaction.running'; archivePath?: string }
  | { type: 'compaction.finished'; summaryPath?: string }
  | { type: 'compaction.failed'; error?: string }
);

export type ConversationCompactionStatus =
  | { status: 'running'; archivePath?: string }
  | { status: 'finished'; summaryPath?: string }
  | { status: 'failed'; error?: string };

export type ConversationActivityOf<Type extends ConversationActivity['type']> = Extract<
  ConversationActivity,
  { type: Type }
>;

export type ConversationActivityHandlerMap<Context, Result = void> = {
  [Type in ConversationActivity['type']]?: (activity: ConversationActivityOf<Type>, context: Context) => Result;
};

export function applyConversationActivityHandler<Context, Result = void>(
  activity: ConversationActivity,
  handlers: ConversationActivityHandlerMap<Context, Result>,
  context: Context,
): Result | undefined {
  const handler = handlers[activity.type] as ((activity: ConversationActivity, context: Context) => Result) | undefined;
  return handler?.(activity, context);
}

type TraceProjectorMap = {
  [Type in TraceEvent['type']]: (event: Extract<TraceEvent, { type: Type }>) => ConversationActivity[];
};

type AgentLoopProjectorMap = {
  [Type in AgentLoopEvent['type']]?: (event: Extract<AgentLoopEvent, { type: Type }>) => ConversationActivity[];
};

type CompactionProjectorMap = {
  [Status in ConversationCompactionStatus['status']]: (event: Extract<ConversationCompactionStatus, { status: Status }>) => ConversationActivity[];
};

const traceProjectors: TraceProjectorMap = {
  'run.started': (event) => [{ type: 'run.started', ...traceCorrelation(event) }],
  'assistant.turn': (event) => [{
    type: 'assistant.turn',
    requestedTools: event.requestedTools,
    rationale: event.diagnostics?.rationale,
    ...traceCorrelation(event),
  }],
  'host.warning': () => [],
  'tool.approval_requested': (event) => [{
    type: 'tool.approval_requested',
    tool: event.call.tool,
    toolSummary: summarizeToolCall(event.call.tool, event.call.input),
    call: event.call,
    ...traceCorrelation(event),
  }],
  'tool.approval_resolved': (event) => [{
    type: 'tool.approval_resolved',
    tool: event.call.tool,
    toolSummary: summarizeToolCall(event.call.tool, event.call.input),
    approved: event.approved,
    reason: event.reason,
    call: event.call,
    ...traceCorrelation(event),
  }],
  'tool.fallback': (event) => [{
    type: 'tool.fallback',
    fromTool: event.fromCall.tool,
    toTool: event.toCall.tool,
    fromSummary: summarizeToolCall(event.fromCall.tool, event.fromCall.input),
    toSummary: summarizeToolCall(event.toCall.tool, event.toCall.input),
    reason: event.reason,
    ...traceCorrelation(event),
  }],
  'tool.call': (event) => [{
    type: 'tool.call',
    toolSummary: summarizeToolCall(event.call.tool, event.call.input),
    ...traceCorrelation(event),
  }],
  'tool.result': (event) => [{
    type: 'tool.result',
    tool: event.tool,
    toolSummary: summarizeToolResult(event.tool, { output: event.result.output }),
    ok: event.result.ok,
    error: event.result.error,
    ...traceCorrelation(event),
  }],
  'memory.candidate_recorded': (event) => [{
    type: 'memory.candidate_recorded',
    candidateId: event.candidateId,
    ...traceCorrelation(event),
  }],
  'memory.checkpoint_skipped': () => [],
  'memory.maintenance_started': (event) => [{
    type: 'memory.maintenance_started',
    candidateCount: event.candidateIds.length,
    ...traceCorrelation(event),
  }],
  'memory.maintenance_finished': (event) => [{
    type: 'memory.maintenance_finished',
    outcome: event.outcome,
    summary: event.summary,
    ...traceCorrelation(event),
  }],
  'memory.maintenance_failed': (event) => [{
    type: 'memory.maintenance_failed',
    error: event.error,
    ...traceCorrelation(event),
  }],
  'cyberloop.annotation': (event) => (
    event.driftLevel === 'unknown' ? [] : [{
      type: 'cyberloop.annotation',
      driftLevel: event.driftLevel,
      metrics: formatCyberLoopMetrics(event.metadata),
      ...traceCorrelation(event),
    }]
  ),
  'run.finished': (event) => [{ type: 'run.finished', outcome: event.outcome, ...traceCorrelation(event) }],
};

const agentLoopProjectors: AgentLoopProjectorMap = {
  'loop.started': (event) => [{ type: 'loop.started', ...agentLoopCorrelation(event) }],
  'assistant.stream': (event) => [{
    type: 'assistant.stream',
    text: event.text,
    done: event.done,
    ...agentLoopCorrelation(event),
  }],
  'tool.calling': (event) => [{ type: 'tool.calling', tool: event.tool, ...agentLoopCorrelation(event) }],
  'tool.completed': (event) => [{
    type: 'tool.completed',
    tool: event.tool,
    durationMs: event.durationMs,
    ...agentLoopCorrelation(event),
  }],
  trace: (event) => projectTraceEventToConversationActivities(event.event)
    .map((activity) => ({ runId: event.runId, ...activity })),
  'loop.finished': (event) => [{ type: 'loop.finished', ...agentLoopCorrelation(event) }],
};

const compactionProjectors: CompactionProjectorMap = {
  running: (event) => [{ type: 'compaction.running', archivePath: event.archivePath }],
  finished: (event) => [{ type: 'compaction.finished', summaryPath: event.summaryPath }],
  failed: (event) => [{ type: 'compaction.failed', error: event.error }],
};

export function projectTraceEventToConversationActivities(event: TraceEvent): ConversationActivity[] {
  const projector = traceProjectors[event.type] as (event: TraceEvent) => ConversationActivity[];
  return projector(event);
}

export function projectAgentLoopEventToConversationActivities(event: AgentLoopEvent): ConversationActivity[] {
  const projector = agentLoopProjectors[event.type] as ((event: AgentLoopEvent) => ConversationActivity[]) | undefined;
  return projector?.(event) ?? [];
}

export function projectCompactionStatusToConversationActivities(event: ConversationCompactionStatus): ConversationActivity[] {
  const projector = compactionProjectors[event.status] as (event: ConversationCompactionStatus) => ConversationActivity[];
  return projector(event);
}

function traceCorrelation(event: TraceEvent): ConversationActivityCorrelation {
  const correlation: ConversationActivityCorrelation = { timestamp: event.timestamp };
  if ('runId' in event) {
    correlation.runId = event.runId;
  }
  if ('step' in event) {
    correlation.step = event.step;
  }
  return correlation;
}

function agentLoopCorrelation(event: AgentLoopEvent): ConversationActivityCorrelation {
  const correlation: ConversationActivityCorrelation = {
    runId: event.runId,
    timestamp: event.timestamp,
  };
  if ('step' in event) {
    correlation.step = event.step;
  }
  return correlation;
}

export function summarizeToolCall(tool: string, input: unknown, maxChars = DEFAULT_MAX_TOOL_SUMMARY_CHARS): string {
  if (tool === 'update_plan') {
    return summarizePlanInput(tool, input, maxChars);
  }

  const command = readStringField(input, 'command');
  if (command) {
    return `${tool} (${truncate(command, maxChars)})`;
  }

  if (tool === 'search_files') {
    return summarizeSearchInput(tool, input, maxChars);
  }

  const moveSummary = summarizeMoveInput(tool, input, maxChars);
  if (moveSummary) {
    return moveSummary;
  }

  const path = readStringField(input, 'path');
  return path ? `${tool} (${truncate(path, maxChars)})` : tool;
}

export function summarizeToolResult(
  tool: string,
  options: { output?: unknown; maxChars?: number } = {},
): string {
  const maxChars = options.maxChars ?? DEFAULT_MAX_TOOL_SUMMARY_CHARS;
  const command = readStringField(options.output, 'command');
  if (command) {
    return `${tool} (${truncate(command, maxChars)})`;
  }

  const moveSummary = summarizeMoveInput(tool, options.output, maxChars);
  if (moveSummary) {
    return moveSummary;
  }

  const outputPath = readStringField(options.output, 'path');
  if (outputPath) {
    return `${tool} (${truncate(outputPath, maxChars)})`;
  }

  return tool;
}

function summarizeMoveInput(tool: string, input: unknown, maxChars: number): string | undefined {
  const from = readStringField(input, 'from');
  const to = readStringField(input, 'to');
  if (!from && !to) {
    return undefined;
  }

  const segmentChars = Math.max(12, Math.floor(maxChars / 2));
  return `${tool} (${from ? truncate(from, segmentChars) : '?'} -> ${to ? truncate(to, segmentChars) : '?'})`;
}

function summarizeSearchInput(tool: string, input: unknown, maxChars: number): string {
  const query = readStringField(input, 'query');
  if (!query) {
    return tool;
  }

  const path = readStringField(input, 'path');
  const segmentChars = Math.max(12, Math.floor(maxChars / 2));
  const querySummary = truncate(JSON.stringify(query), segmentChars);
  return path ?
      `${tool} (${querySummary} in ${truncate(path, segmentChars)})`
    : `${tool} (${querySummary})`;
}

function summarizePlanInput(tool: string, input: unknown, maxChars: number): string {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return tool;
  }

  const plan = (input as { plan?: unknown }).plan;
  if (!Array.isArray(plan) || plan.length === 0) {
    return tool;
  }

  const currentStep = plan
    .map((item) => getPlanItemStep(item, 'in_progress'))
    .find((step): step is string => Boolean(step));
  return currentStep ? `${tool} (${truncate(currentStep, maxChars)})` : `${tool} (${plan.length} items)`;
}

function getPlanItemStep(item: unknown, status: string): string | undefined {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return undefined;
  }

  const candidate = item as { status?: unknown; step?: unknown };
  return candidate.status === status && typeof candidate.step === 'string' ? candidate.step : undefined;
}

function readStringField(value: unknown, field: string): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const candidate = (value as Record<string, unknown>)[field];
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : undefined;
}

function formatCyberLoopMetrics(metadata: Record<string, unknown>): string {
  const kinematics = metadata.kinematics;
  if (!kinematics || typeof kinematics !== 'object' || Array.isArray(kinematics)) {
    return '';
  }

  const snapshot = kinematics as {
    errorMagnitude?: unknown;
    correctionMagnitude?: unknown;
    isStable?: unknown;
  };
  const parts: string[] = [];
  if (typeof snapshot.errorMagnitude === 'number') {
    parts.push(`err=${formatMetric(snapshot.errorMagnitude)}`);
  }
  if (typeof snapshot.correctionMagnitude === 'number') {
    parts.push(`corr=${formatMetric(snapshot.correctionMagnitude)}`);
  }
  if (typeof snapshot.isStable === 'boolean') {
    parts.push(`stable=${snapshot.isStable}`);
  }

  return parts.length ? ` (${parts.join(' ')})` : '';
}

function formatMetric(value: number): string {
  if (!Number.isFinite(value)) {
    return String(value);
  }
  if (Math.abs(value) < 0.001 && value !== 0) {
    return value.toExponential(2);
  }
  return value.toFixed(3);
}
