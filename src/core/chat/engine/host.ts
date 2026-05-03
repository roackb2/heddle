import {
  projectAgentLoopEventToConversationActivities,
  projectCompactionStatusToConversationActivities,
  projectTraceEventToConversationActivities,
} from '../../observability/conversation-activity.js';
import type { ConversationEngineHost, NormalizedConversationEngineHost } from './types.js';

export function normalizeConversationEngineHost(host?: ConversationEngineHost): NormalizedConversationEngineHost {
  const onActivity = host?.events?.onActivity;
  const onAgentLoopEvent = host?.events?.onAgentLoopEvent;
  const onTraceEvent = host?.trace?.onEvent;
  const onCompactionStatus = host?.compaction?.onStatus;

  return {
    turnHost: {
      events: {
        onAgentLoopEvent: (event) => {
          onAgentLoopEvent?.(event);
          for (const activity of projectAgentLoopEventToConversationActivities(event)) {
            onActivity?.(activity);
          }
        },
      },
      approvals: host?.approvals?.requestToolApproval ? {
        requestToolApproval: host.approvals.requestToolApproval,
      } : undefined,
      compaction: onCompactionStatus ? {
        onPreflightCompactionStatus: (event) => {
          onCompactionStatus(event);
          for (const activity of projectCompactionStatusToConversationActivities(event)) {
            onActivity?.(activity);
          }
        },
        onFinalCompactionStatus: (event) => {
          onCompactionStatus(event);
          for (const activity of projectCompactionStatusToConversationActivities(event)) {
            onActivity?.(activity);
          }
        },
      } : undefined,
    },
    onAssistantStream: host?.assistant?.onText ? ((update) => {
      host.assistant?.onText?.(update.text);
    }) : undefined,
    onTraceEvent: (event) => {
      onTraceEvent?.(event);
      for (const activity of projectTraceEventToConversationActivities(event)) {
        onActivity?.(activity);
      }
    },
    onCompactionStatus: onCompactionStatus ? (event) => {
      onCompactionStatus(event);
      for (const activity of projectCompactionStatusToConversationActivities(event)) {
        onActivity?.(activity);
      }
    } : undefined,
  };
}
