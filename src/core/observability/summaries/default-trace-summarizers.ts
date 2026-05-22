import { truncate } from '@/core/utils/text.js';
import { HeddleEventType } from '@/core/event-types.js';
import { ToolActivitySummarizer } from '@/core/live/index.js';
import type { TraceSummarizerMap } from './types.js';

export const DEFAULT_TRACE_SUMMARIZERS: TraceSummarizerMap = {
  [HeddleEventType.runStarted]: () => undefined,
  [HeddleEventType.assistantTurn]: (event) => [
    ...(event.diagnostics?.rationale ? [`reasoning: ${truncate(event.diagnostics.rationale, 140)}`] : []),
    event.requestedTools ?
      `assistant requested ${event.toolCalls?.map((call) => ToolActivitySummarizer.summarizeCall(call)).join(', ')}`
    : 'assistant answered',
  ],
  [HeddleEventType.hostWarning]: (event) => [`host warning ${event.code}: ${truncate(event.message, 140)}`],
  [HeddleEventType.toolApprovalRequested]: (event) => [`approval requested for ${ToolActivitySummarizer.summarizeCall(event.call)}`],
  [HeddleEventType.toolApprovalResolved]: (event) => [
    `approval ${event.approved ? 'granted' : 'denied'} for ${ToolActivitySummarizer.summarizeCall(event.call)}${event.reason ? ` (${truncate(event.reason, 80)})` : ''}`,
  ],
  [HeddleEventType.toolFallback]: (event) => [
    `fallback ${ToolActivitySummarizer.summarizeCall(event.fromCall)} -> ${ToolActivitySummarizer.summarizeCall(event.toCall)} (${event.reason})`,
  ],
  [HeddleEventType.toolCalling]: (event) => [`tool calling ${ToolActivitySummarizer.summarizeCall(event.call)}`],
  [HeddleEventType.toolCompleted]: (event) => [`tool completed ${event.call.tool}: ${event.result.ok ? 'ok' : event.result.error ?? 'error'}`],
  [HeddleEventType.memoryCandidateRecorded]: (event) => [`memory candidate recorded: ${event.candidateId}`],
  [HeddleEventType.memoryCheckpointSkipped]: (event) => [`memory checkpoint skipped: ${truncate(event.rationale, 100)}`],
  [HeddleEventType.memoryMaintenanceStarted]: (event) => [`memory maintenance started: ${event.candidateIds.join(', ')}`],
  [HeddleEventType.memoryMaintenanceFinished]: (event) => [`memory maintenance finished: ${event.outcome}`],
  [HeddleEventType.memoryMaintenanceFailed]: (event) => [`memory maintenance failed: ${event.error}`],
  [HeddleEventType.cyberloopAnnotation]: () => undefined,
  [HeddleEventType.runFinished]: (event) => [`run finished: ${event.outcome}`],
};
