import {
  applyConversationActivityHandler,
  projectTraceEventToConversationActivities,
  type ConversationActivity,
  type ConversationActivityHandlerMap,
} from '../../../core/observability/conversation-activity.js';
import type { TraceEvent } from '../../../index.js';
import { truncate } from '../../../core/utils/text.js';

export function toLiveEvent(event: TraceEvent): string | undefined {
  return projectTraceEventToConversationActivities(event)
    .map(formatConversationActivityForTui)
    .find((text): text is string => Boolean(text));
}

const tuiActivityFormatters = {
  'run.started': () => 'thinking',
  'assistant.turn': (activity) => {
    if (activity.rationale) {
      return `reasoning: ${truncate(activity.rationale, 140)}`;
    }
    return activity.requestedTools ? undefined : 'answer ready';
  },
  'tool.approval_requested': (activity) => `approval needed for ${activity.toolSummary}`,
  'tool.approval_resolved': (activity) => {
    return `approval ${activity.approved ? 'granted' : 'denied'} for ${activity.toolSummary}${activity.reason ? ` (${truncate(activity.reason, 80)})` : ''}`;
  },
  'tool.fallback': (activity) => {
    return `retrying with ${activity.toSummary} after ${activity.fromSummary} was blocked (${truncate(activity.reason, 80)})`;
  },
  'tool.call': (activity) => `running ${activity.toolSummary}`,
  'tool.result': (activity) => {
    return `${activity.toolSummary} ${activity.ok ? 'completed' : `failed: ${activity.error ?? 'error'}`}`;
  },
  'memory.candidate_recorded': (activity) => `memory candidate recorded: ${activity.candidateId}`,
  'memory.maintenance_started': (activity) => {
    return `memory maintenance started for ${activity.candidateCount} candidate${activity.candidateCount === 1 ? '' : 's'}`;
  },
  'memory.maintenance_finished': (activity) => `memory maintenance ${activity.outcome}`,
  'memory.maintenance_failed': (activity) => `memory maintenance failed: ${truncate(activity.error ?? 'error', 80)}`,
  'cyberloop.annotation': (activity) => {
    return `cyberloop drift=${activity.driftLevel}${activity.metrics}`;
  },
  'run.finished': (activity) => {
    return activity.outcome === 'done' ? undefined : `stopped: ${activity.outcome}`;
  },
} satisfies ConversationActivityHandlerMap<undefined, string | undefined>;

export function formatConversationActivityForTui(activity: ConversationActivity): string | undefined {
  return applyConversationActivityHandler(activity, tuiActivityFormatters, undefined);
}
