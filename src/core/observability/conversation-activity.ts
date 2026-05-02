import type { AgentLoopEvent } from '../runtime/events.js';
import type { TraceEvent, ToolCall } from '../types.js';
import { truncate } from '../utils/text.js';

const MAX_TOOL_CALL_SUMMARY_CHARS = 96;

export type ConversationActivity =
  | { type: 'loop.started' }
  | { type: 'loop.finished' }
  | { type: 'assistant.stream'; text: string; done: boolean }
  | { type: 'assistant.turn'; requestedTools: boolean; rationale?: string }
  | { type: 'tool.calling'; tool: string; step?: number }
  | { type: 'tool.completed'; tool: string; durationMs?: number }
  | { type: 'run.started' }
  | { type: 'run.finished'; outcome: string }
  | { type: 'tool.approval_requested'; tool: string; toolSummary: string; step?: number; call: ToolCall }
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
  | { type: 'compaction.failed'; error?: string };

export type ConversationCompactionStatus =
  | { status: 'running'; archivePath?: string }
  | { status: 'finished'; summaryPath?: string }
  | { status: 'failed'; error?: string };

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
  'run.started': () => [{ type: 'run.started' }],
  'assistant.turn': (event) => [{
    type: 'assistant.turn',
    requestedTools: event.requestedTools,
    rationale: event.diagnostics?.rationale,
  }],
  'host.warning': () => [],
  'tool.approval_requested': (event) => [{
    type: 'tool.approval_requested',
    tool: event.call.tool,
    toolSummary: summarizeActivityToolCall(event.call.tool, event.call.input),
    step: event.step,
    call: event.call,
  }],
  'tool.approval_resolved': (event) => [{
    type: 'tool.approval_resolved',
    tool: event.call.tool,
    toolSummary: summarizeActivityToolCall(event.call.tool, event.call.input),
    approved: event.approved,
    reason: event.reason,
    call: event.call,
  }],
  'tool.fallback': (event) => [{
    type: 'tool.fallback',
    fromTool: event.fromCall.tool,
    toTool: event.toCall.tool,
    fromSummary: summarizeActivityToolCall(event.fromCall.tool, event.fromCall.input),
    toSummary: summarizeActivityToolCall(event.toCall.tool, event.toCall.input),
    reason: event.reason,
  }],
  'tool.call': (event) => [{ type: 'tool.call', toolSummary: summarizeActivityToolCall(event.call.tool, event.call.input) }],
  'tool.result': (event) => [{
    type: 'tool.result',
    tool: event.tool,
    toolSummary: summarizeActivityToolResult(event.tool, extractShellCommand(event.result.output), event.result.output),
    ok: event.result.ok,
    error: event.result.error,
  }],
  'memory.candidate_recorded': (event) => [{ type: 'memory.candidate_recorded', candidateId: event.candidateId }],
  'memory.checkpoint_skipped': () => [],
  'memory.maintenance_started': (event) => [{ type: 'memory.maintenance_started', candidateCount: event.candidateIds.length }],
  'memory.maintenance_finished': (event) => [{
    type: 'memory.maintenance_finished',
    outcome: event.outcome,
    summary: event.summary,
  }],
  'memory.maintenance_failed': (event) => [{ type: 'memory.maintenance_failed', error: event.error }],
  'cyberloop.annotation': (event) => (
    event.driftLevel === 'unknown' ? [] : [{
      type: 'cyberloop.annotation',
      driftLevel: event.driftLevel,
      metrics: formatCyberLoopMetrics(event.metadata),
    }]
  ),
  'run.finished': (event) => [{ type: 'run.finished', outcome: event.outcome }],
};

const agentLoopProjectors: AgentLoopProjectorMap = {
  'loop.started': () => [{ type: 'loop.started' }],
  'assistant.stream': (event) => [{ type: 'assistant.stream', text: event.text, done: event.done }],
  'tool.calling': (event) => [{ type: 'tool.calling', tool: event.tool, step: event.step }],
  'tool.completed': (event) => [{ type: 'tool.completed', tool: event.tool, durationMs: event.durationMs }],
  trace: (event) => projectTraceEventToConversationActivities(event.event),
  'loop.finished': () => [{ type: 'loop.finished' }],
};

const compactionProjectors: CompactionProjectorMap = {
  running: (event) => [{ type: 'compaction.running', archivePath: event.archivePath }],
  finished: (event) => [{ type: 'compaction.finished', summaryPath: event.summaryPath }],
  failed: (event) => [{ type: 'compaction.failed', error: event.error }],
};

export function projectTraceEventToConversationActivities(event: TraceEvent): ConversationActivity[] {
  return traceProjectors[event.type](event as never);
}

export function projectAgentLoopEventToConversationActivities(event: AgentLoopEvent): ConversationActivity[] {
  const projector = agentLoopProjectors[event.type] as ((event: AgentLoopEvent) => ConversationActivity[]) | undefined;
  return projector?.(event) ?? [];
}

export function projectCompactionStatusToConversationActivities(event: ConversationCompactionStatus): ConversationActivity[] {
  return compactionProjectors[event.status](event as never);
}

export function summarizeActivityToolCall(tool: string, input: unknown): string {
  const planSummary = summarizePlanInput(tool, input);
  if (planSummary) {
    return planSummary;
  }

  const shellCommand = extractShellCommand(input);
  if (shellCommand) {
    return `${tool} (${truncate(shellCommand, MAX_TOOL_CALL_SUMMARY_CHARS)})`;
  }

  const searchSummary = summarizeSearchInput(tool, input);
  if (searchSummary) {
    return searchSummary;
  }

  const path = extractPathField(input);
  if (isPathAwareTool(tool) && path) {
    return `${tool} (${truncate(path, MAX_TOOL_CALL_SUMMARY_CHARS)})`;
  }

  return tool;
}

export function summarizeActivityToolResult(tool: string, command: string | undefined, output?: unknown): string {
  if (command) {
    return `${tool} (${truncate(command, MAX_TOOL_CALL_SUMMARY_CHARS)})`;
  }

  const outputPath = extractPathField(output);
  if (tool === 'edit_file' && outputPath) {
    return `${tool} (${truncate(outputPath, MAX_TOOL_CALL_SUMMARY_CHARS)})`;
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

function extractQueryField(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const query = (value as { query?: unknown }).query;
  return typeof query === 'string' && query.trim() ? query.trim() : undefined;
}

function isPathAwareTool(tool: string): boolean {
  return tool === 'edit_file' || tool === 'read_file' || tool === 'list_files';
}

function summarizeSearchInput(tool: string, input: unknown): string | undefined {
  if (tool !== 'search_files') {
    return undefined;
  }

  const query = extractQueryField(input);
  if (!query) {
    return tool;
  }

  const path = extractPathField(input);
  const querySummary = truncate(JSON.stringify(query), Math.max(12, Math.floor(MAX_TOOL_CALL_SUMMARY_CHARS / 2)));
  if (path) {
    return `${tool} (${querySummary} in ${truncate(path, Math.max(12, Math.floor(MAX_TOOL_CALL_SUMMARY_CHARS / 2)))})`;
  }

  return `${tool} (${querySummary})`;
}

function summarizePlanInput(tool: string, input: unknown): string | undefined {
  if (tool !== 'update_plan') {
    return undefined;
  }

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return tool;
  }

  const plan = (input as { plan?: unknown }).plan;
  if (!Array.isArray(plan) || plan.length === 0) {
    return tool;
  }

  const current = plan.find((item) => (
    item
    && typeof item === 'object'
    && !Array.isArray(item)
    && (item as { status?: unknown }).status === 'in_progress'
  ));
  const currentStep = current && typeof (current as { step?: unknown }).step === 'string' ? (current as { step: string }).step : undefined;
  return currentStep ? `${tool} (${truncate(currentStep, MAX_TOOL_CALL_SUMMARY_CHARS)})` : `${tool} (${plan.length} items)`;
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
