import type { RunAgentLoopOptions } from '@/core/runtime/agent-loop.js';
import type { ToolCall, ToolDefinition } from '@/core/types.js';
import type { ChatTurnHostBridge, CreateChatTurnHostBridgeArgs } from './types.js';

/**
 * Bridges optional host ports into the lower-level agent-loop callbacks.
 */
export class ChatTurnHostBridgeBuilder {
  static build(args: CreateChatTurnHostBridgeArgs): ChatTurnHostBridge {
    const onAgentLoopEvent = args.host?.events?.onAgentLoopEvent;
    const requestToolApproval = args.host?.approvals?.requestToolApproval;
    const approveToolCall: RunAgentLoopOptions['approveToolCall'] | undefined = requestToolApproval
      ? ((call: ToolCall, tool: ToolDefinition) =>
          requestToolApproval({ call, tool }) ?? Promise.resolve({ approved: false, reason: 'Missing approval port.' }))
      : undefined;

    return {
      onAgentLoopEvent,
      approveToolCall,
      notifyPreflightCompactionStatus(event) {
        args.onCompactionStatus?.(event);
        args.host?.compaction?.onPreflightCompactionStatus?.(event);
      },
      notifyFinalCompactionStatus(event) {
        args.onCompactionStatus?.(event);
        args.host?.compaction?.onFinalCompactionStatus?.(event);
      },
    };
  }
}
