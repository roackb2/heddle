import type { ConversationEngineHost } from '@/core/chat/engine/types.js';
import { AgentLoopRuntimeService } from '@/core/runtime/loop/index.js';
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
      onActivity,
      onEvent: (event) => {
        onEvent?.(event);
        if (AgentLoopRuntimeService.isConversationActivity(event)) {
          onActivity?.(event);
        }
      },
      approveToolCall: requestToolApproval
        ? ((call, tool, autonomyEvaluation, reason) => requestToolApproval({
          call,
          tool,
          ...(reason ? { reason } : {}),
          ...(autonomyEvaluation ? { autonomyEvaluation } : {}),
        }))
        : undefined,
      onCompactionStatus: (event, phase) => {
        host?.compaction?.onStatus?.(event);
        if (phase === 'preflight') {
          host?.compaction?.onPreflightCompactionStatus?.(event);
          onActivity?.(event);
          return;
        }

        if (phase === 'recovery') {
          host?.compaction?.onRecoveryCompactionStatus?.(event);
          onActivity?.(event);
          return;
        }

        host?.compaction?.onFinalCompactionStatus?.(event);
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
}
