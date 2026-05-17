import { truncate } from '@/core/utils/text.js';
import { ToolActivitySummarizer } from '../activity/index.js';
import type { TraceSummarizerMap } from './types.js';

export const DEFAULT_TRACE_SUMMARIZERS: TraceSummarizerMap = {
  'run.started': () => undefined,
  'assistant.turn': (event) => [
    ...(event.diagnostics?.rationale ? [`reasoning: ${truncate(event.diagnostics.rationale, 140)}`] : []),
    event.requestedTools ?
      `assistant requested ${event.toolCalls?.map((call) => ToolActivitySummarizer.summarizeCall(call)).join(', ')}`
    : 'assistant answered',
  ],
  'host.warning': (event) => [`host warning ${event.code}: ${truncate(event.message, 140)}`],
  'tool.approval_requested': (event) => [`approval requested for ${ToolActivitySummarizer.summarizeCall(event.call)}`],
  'tool.approval_resolved': (event) => [
    `approval ${event.approved ? 'granted' : 'denied'} for ${ToolActivitySummarizer.summarizeCall(event.call)}${event.reason ? ` (${truncate(event.reason, 80)})` : ''}`,
  ],
  'tool.fallback': (event) => [
    `fallback ${ToolActivitySummarizer.summarizeCall(event.fromCall)} -> ${ToolActivitySummarizer.summarizeCall(event.toCall)} (${event.reason})`,
  ],
  'tool.call': (event) => [`tool call ${ToolActivitySummarizer.summarizeCall(event.call)}`],
  'tool.result': (event) => [`tool result ${event.tool}: ${event.result.ok ? 'ok' : event.result.error ?? 'error'}`],
  'memory.candidate_recorded': (event) => [`memory candidate recorded: ${event.candidateId}`],
  'memory.checkpoint_skipped': (event) => [`memory checkpoint skipped: ${truncate(event.rationale, 100)}`],
  'memory.maintenance_started': (event) => [`memory maintenance started: ${event.candidateIds.join(', ')}`],
  'memory.maintenance_finished': (event) => [`memory maintenance finished: ${event.outcome}`],
  'memory.maintenance_failed': (event) => [`memory maintenance failed: ${event.error}`],
  'cyberloop.annotation': () => undefined,
  'run.finished': (event) => [`run finished: ${event.outcome}`],
};
