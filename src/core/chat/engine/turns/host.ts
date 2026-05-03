import type {
  ConversationEngineHost,
  NormalizedConversationEngineHost,
} from '../types.js';
import {
  projectAgentLoopEventToConversationActivities,
  projectCompactionStatusToConversationActivities,
  projectTraceEventToConversationActivities,
} from '../../../observability/conversation-activity.js';
import type { ChatTurnHostPort } from './host-bridge.js';

export function normalizeConversationEngineHost(host?: ConversationEngineHost): NormalizedConversationEngineHost {
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
    onAssistantStream: host?.assistant?.onText
      ? ((update) => {
          host.assistant?.onText?.(update.text);
        })
      : undefined,
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
