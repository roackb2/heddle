import type {
  ConversationEngineHost,
  NormalizedConversationEngineHost,
} from '@/core/chat/engine/types.js';
import {
  projectAgentLoopEventToConversationActivities,
  projectCompactionStatusToConversationActivities,
  projectTraceEventToConversationActivities,
} from '@/core/observability/conversation-activity.js';
import type { ChatTurnHostPort } from './types.js';

/**
 * Normalizes host-facing engine callbacks into turn-runtime ports.
 */
export class ConversationEngineHostNormalizer {
  static normalize(host?: ConversationEngineHost): NormalizedConversationEngineHost {
    const onActivity = host?.events?.onActivity;
    const onAgentLoopEvent = host?.events?.onAgentLoopEvent;
    const onTraceEvent = host?.trace?.onEvent;

    const turnHost: ChatTurnHostPort = {
      events: {
        onAgentLoopEvent: (event) => {
          onAgentLoopEvent?.(event);
          for (const activity of projectAgentLoopEventToConversationActivities(event)) {
            onActivity?.(activity);
          }
        },
      },
      approvals: host?.approvals?.requestToolApproval
        ? {
            requestToolApproval: host.approvals.requestToolApproval,
          }
        : undefined,
    };

    return {
      turnHost,
      onAssistantStream: host?.assistant?.onStream
        ?? (host?.assistant?.onText
          ? ((update) => {
              host.assistant?.onText?.(update.text);
            })
          : undefined),
      onTraceEvent: (event) => {
        onTraceEvent?.(event);
        for (const activity of projectTraceEventToConversationActivities(event)) {
          onActivity?.(activity);
        }
      },
      onCompactionStatus: (event) => {
        host?.compaction?.onStatus?.(event);
        for (const activity of projectCompactionStatusToConversationActivities(event)) {
          onActivity?.(activity);
        }
      },
    };
  }
}
