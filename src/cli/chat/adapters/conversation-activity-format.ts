import type { ConversationActivity, ConversationActivityHandlerMap } from '@/core/live/index.js';
import { truncate } from '../../../core/utils/text.js';

const tuiActivityFormatters: ConversationActivityHandlerMap<undefined, string | undefined> = {
  'loop.started': () => 'thinking',
  'tool.approval_requested': (activity) => `approval needed for ${activity.derived?.kind === 'tool-summary' ? activity.derived.summary : activity.call.tool}`,
  'tool.approval_resolved': (activity) => {
    const summary = activity.derived?.kind === 'tool-summary' ? activity.derived.summary : activity.call.tool;
    return `approval ${activity.approved ? 'granted' : 'denied'} for ${summary}${activity.reason ? ` (${truncate(activity.reason, 80)})` : ''}`;
  },
  'tool.fallback': (activity) => {
    const fallback = activity.derived?.kind === 'tool-fallback-summary' ? activity.derived : undefined;
    return `retrying with ${fallback?.toSummary ?? activity.toCall.tool} after ${fallback?.fromSummary ?? activity.fromCall.tool} was blocked (${truncate(activity.reason, 80)})`;
  },
  'tool.calling': (activity) => `running ${activity.derived?.kind === 'tool-summary' ? activity.derived.summary : activity.tool}`,
  'tool.completed': (activity) => `${activity.tool} completed in ${Math.round(activity.durationMs)}ms`,
  'compaction.running': () => 'Compacting earlier conversation history…',
  'compaction.failed': (activity) => `Compaction failed: ${activity.error ?? 'unknown error'}`,
  'compaction.finished': () => 'Compaction finished.',
  'loop.finished': (activity) => {
    return activity.outcome === 'done' ? undefined : `stopped: ${activity.outcome}`;
  },
};

export function formatTuiConversationActivity(activity: ConversationActivity): string | undefined {
  const formatter = tuiActivityFormatters[activity.type] as ((activity: ConversationActivity) => string | undefined) | undefined;
  return formatter?.(activity);
}
