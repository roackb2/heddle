import {
  ConversationActivityProjector,
  type ConversationActivity,
  type ConversationActivityHandlerMap,
} from '@/core/chat/engine/live/index.js';
import type { TraceEvent } from '../../../index.js';
import { truncate } from '../../../core/utils/text.js';

export function toLiveEvent(event: TraceEvent): string | undefined {
  return ConversationActivityProjector.fromTraceEvent(event)
    .map(formatConversationActivityForTui)
    .find((text): text is string => Boolean(text));
}

const tuiActivityFormatters = {
  'run.started': () => 'thinking',
  'assistant.turn': (activity) => {
    const rationale = activity.event.diagnostics?.rationale;
    if (rationale) {
      return `reasoning: ${truncate(rationale, 140)}`;
    }
    return activity.event.requestedTools ? undefined : 'answer ready';
  },
  'tool.approval_requested': (activity) => `approval needed for ${activity.derived?.kind === 'tool-summary' ? activity.derived.summary : activity.event.call.tool}`,
  'tool.approval_resolved': (activity) => {
    const summary = activity.derived?.kind === 'tool-summary' ? activity.derived.summary : activity.event.call.tool;
    return `approval ${activity.event.approved ? 'granted' : 'denied'} for ${summary}${activity.event.reason ? ` (${truncate(activity.event.reason, 80)})` : ''}`;
  },
  'tool.fallback': (activity) => {
    const fallback = activity.derived?.kind === 'tool-fallback-summary' ? activity.derived : undefined;
    return `retrying with ${fallback?.toSummary ?? activity.event.toCall.tool} after ${fallback?.fromSummary ?? activity.event.fromCall.tool} was blocked (${truncate(activity.event.reason, 80)})`;
  },
  'tool.calling': (activity) => `running ${activity.derived?.kind === 'tool-summary' ? activity.derived.summary : activity.event.tool}`,
  'tool.completed': (activity) => `${activity.event.tool} completed in ${Math.round(activity.event.durationMs)}ms`,
  'tool.call': (activity) => `running ${activity.derived?.kind === 'tool-summary' ? activity.derived.summary : activity.event.call.tool}`,
  'tool.result': (activity) => {
    const summary = activity.derived?.kind === 'tool-summary' ? activity.derived.summary : activity.event.tool;
    return `${summary} ${activity.event.result.ok ? 'completed' : `failed: ${activity.event.result.error ?? 'error'}`}`;
  },
  'memory.candidate_recorded': (activity) => `memory candidate recorded: ${activity.event.candidateId}`,
  'memory.maintenance_started': (activity) => {
    const candidateCount = activity.event.candidateIds.length;
    return `memory maintenance started for ${candidateCount} candidate${candidateCount === 1 ? '' : 's'}`;
  },
  'memory.maintenance_finished': (activity) => `memory maintenance ${activity.event.outcome}`,
  'memory.maintenance_failed': (activity) => `memory maintenance failed: ${truncate(activity.event.error, 80)}`,
  'cyberloop.annotation': (activity) => {
    const metrics = activity.derived?.kind === 'cyberloop-metrics' ? activity.derived.metrics : '';
    return `cyberloop drift=${activity.event.driftLevel}${metrics}`;
  },
  'compaction.running': () => 'Compacting earlier conversation history…',
  'compaction.failed': (activity) => `Compaction failed: ${activity.event.error ?? 'unknown error'}`,
  'compaction.finished': () => 'Compaction finished.',
  'run.finished': (activity) => {
    return activity.event.outcome === 'done' ? undefined : `stopped: ${activity.event.outcome}`;
  },
} satisfies ConversationActivityHandlerMap<undefined, string | undefined>;

export function formatConversationActivityForTui(activity: ConversationActivity): string | undefined {
  return ConversationActivityProjector.applyHandler({
    activity,
    handlers: tuiActivityFormatters,
    context: undefined,
  });
}
