import type { ConversationEngineHost } from '@/core/chat/engine/types.js';
import type { ConversationAgentLoopActivity } from '@/core/live/index.js';
import type { AgentLoopEvent } from '@/core/runtime/loop/index.js';
import { HeddleEventType } from '@/core/event-types.js';
import type { ChatTurnHostPort, ConversationEngineHostAdapterResult } from './types.js';

/**
 * Normalizes host-facing engine callbacks into turn-runtime ports.
 */
export class ConversationEngineHostNormalizer {
  static normalize(host?: ConversationEngineHost): ConversationEngineHostAdapterResult {
    const onActivity = host?.events?.onActivity;
    const onEvent = host?.events?.onEvent;
    const onTraceEvent = host?.trace?.onEvent;
    const requestToolApproval = host?.approvals?.requestToolApproval;

    const turnHost: ChatTurnHostPort = {
      onEvent: (event) => {
        onEvent?.(event);
        if (ConversationEngineHostNormalizer.isConversationActivity(event)) {
          onActivity?.(event);
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
        onActivity?.(event);
      },
    };

    return {
      turnHost,
      onTraceEvent: (event) => {
        onTraceEvent?.(event);
      },
    };
  }

  private static isConversationActivity(event: AgentLoopEvent): event is Extract<AgentLoopEvent, ConversationAgentLoopActivity> {
    return event.type !== HeddleEventType.trace
      && event.type !== HeddleEventType.loopResumed
      && event.type !== HeddleEventType.checkpointSaved;
  }
}
