import {
  projectTraceEventToConversationActivities,
  type ConversationActivity,
} from '../../../core/observability/conversation-activity.js';
import type { TraceEvent } from '../../../index.js';
import { truncate } from '../../../core/utils/text.js';

export function toLiveEvent(event: TraceEvent): string | undefined {
  return projectTraceEventToConversationActivities(event)
    .map(formatConversationActivityForTui)
    .find((text): text is string => Boolean(text));
}

const tuiActivityFormatters: Partial<Record<ConversationActivity['type'], (activity: ConversationActivity) => string | undefined>> = {
  'run.started': () => 'thinking',
  'assistant.turn': (activity) => {
    const assistantActivity = activity as Extract<ConversationActivity, { type: 'assistant.turn' }>;
    if (assistantActivity.rationale) {
      return `reasoning: ${truncate(assistantActivity.rationale, 140)}`;
    }
    return assistantActivity.requestedTools ? undefined : 'answer ready';
  },
  'tool.approval_requested': (activity) => `approval needed for ${(activity as Extract<ConversationActivity, { type: 'tool.approval_requested' }>).toolSummary}`,
  'tool.approval_resolved': (activity) => {
    const approvalActivity = activity as Extract<ConversationActivity, { type: 'tool.approval_resolved' }>;
    return `approval ${approvalActivity.approved ? 'granted' : 'denied'} for ${approvalActivity.toolSummary}${approvalActivity.reason ? ` (${truncate(approvalActivity.reason, 80)})` : ''}`;
  },
  'tool.fallback': (activity) => {
    const fallbackActivity = activity as Extract<ConversationActivity, { type: 'tool.fallback' }>;
    return `retrying with ${fallbackActivity.toSummary} after ${fallbackActivity.fromSummary} was blocked (${truncate(fallbackActivity.reason, 80)})`;
  },
  'tool.call': (activity) => `running ${(activity as Extract<ConversationActivity, { type: 'tool.call' }>).toolSummary}`,
  'tool.result': (activity) => {
    const toolActivity = activity as Extract<ConversationActivity, { type: 'tool.result' }>;
    return `${toolActivity.toolSummary} ${toolActivity.ok ? 'completed' : `failed: ${toolActivity.error ?? 'error'}`}`;
  },
  'memory.candidate_recorded': (activity) => `memory candidate recorded: ${(activity as Extract<ConversationActivity, { type: 'memory.candidate_recorded' }>).candidateId}`,
  'memory.maintenance_started': (activity) => {
    const memoryActivity = activity as Extract<ConversationActivity, { type: 'memory.maintenance_started' }>;
    return `memory maintenance started for ${memoryActivity.candidateCount} candidate${memoryActivity.candidateCount === 1 ? '' : 's'}`;
  },
  'memory.maintenance_finished': (activity) => `memory maintenance ${(activity as Extract<ConversationActivity, { type: 'memory.maintenance_finished' }>).outcome}`,
  'memory.maintenance_failed': (activity) => `memory maintenance failed: ${truncate((activity as Extract<ConversationActivity, { type: 'memory.maintenance_failed' }>).error ?? 'error', 80)}`,
  'cyberloop.annotation': (activity) => {
    const cyberloopActivity = activity as Extract<ConversationActivity, { type: 'cyberloop.annotation' }>;
    return `cyberloop drift=${cyberloopActivity.driftLevel}${cyberloopActivity.metrics}`;
  },
  'run.finished': (activity) => {
    const runActivity = activity as Extract<ConversationActivity, { type: 'run.finished' }>;
    return runActivity.outcome === 'done' ? undefined : `stopped: ${runActivity.outcome}`;
  },
};

export function formatConversationActivityForTui(activity: ConversationActivity): string | undefined {
  return tuiActivityFormatters[activity.type]?.(activity);
}
