import type { ConversationEngineHost } from '@/core/chat/engine/types.js';
import { ConversationActivityProjector } from '@/core/observability/index.js';
import type { ChatTurnHostPort, ConversationEngineHostAdapterResult } from './types.js';

/**
 * Normalizes host-facing engine callbacks into turn-runtime ports.
 */
export class ConversationEngineHostNormalizer {
  static normalize(host?: ConversationEngineHost): ConversationEngineHostAdapterResult {
    const onActivity = host?.events?.onActivity;
    const onAgentLoopEvent = host?.events?.onAgentLoopEvent;
    const onTraceEvent = host?.trace?.onEvent;
    const requestToolApproval = host?.approvals?.requestToolApproval;

    const turnHost: ChatTurnHostPort = {
      onAgentLoopEvent: (event) => {
        onAgentLoopEvent?.(event);
        for (const activity of ConversationActivityProjector.fromAgentLoopEvent(event)) {
          onActivity?.(activity);
        }
      },
      approveToolCall: requestToolApproval
        ? ((call, tool) => requestToolApproval({ call, tool }))
        : undefined,
      onCompactionStatus: (event, phase) => {
        host?.compaction?.onStatus?.(event);
        if (phase === 'preflight') {
          host?.compaction?.onPreflightCompactionStatus?.(event);
        } else {
          host?.compaction?.onFinalCompactionStatus?.(event);
        }
        for (const activity of ConversationActivityProjector.fromCompactionStatus(event)) {
          onActivity?.(activity);
        }
      },
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
        for (const activity of ConversationActivityProjector.fromTraceEvent(event)) {
          onActivity?.(activity);
        }
      },
    };
  }
}
