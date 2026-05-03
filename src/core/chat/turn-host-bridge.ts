import type { RunAgentLoopOptions } from '../runtime/agent-loop.js';
import type { AgentLoopEvent } from '../runtime/events.js';
import type { ToolCall, ToolDefinition } from '../types.js';
import type { ChatTurnHostPort } from './turn-host.js';
import type { PersistChatTurnCompactionStatus } from './session-turn-result.js';
import type { ChatTurnPreflightCompactionStatus } from './session-turn-preflight.js';

export type CreateChatTurnHostBridgeArgs = {
  host?: ChatTurnHostPort;
  onLegacyCompactionStatus?: (event: ChatTurnPreflightCompactionStatus | PersistChatTurnCompactionStatus) => void;
};

export type ChatTurnHostBridge = {
  onAgentLoopEvent?: (event: AgentLoopEvent) => void;
  approveToolCall?: RunAgentLoopOptions['approveToolCall'];
  notifyPreflightCompactionStatus(event: ChatTurnPreflightCompactionStatus): void;
  notifyFinalCompactionStatus(event: PersistChatTurnCompactionStatus): void;
};

export function createChatTurnHostBridge(args: CreateChatTurnHostBridgeArgs): ChatTurnHostBridge {
  const onAgentLoopEvent = args.host?.events?.onAgentLoopEvent;
  const requestToolApproval = args.host?.approvals?.requestToolApproval;
  const approveToolCall: RunAgentLoopOptions['approveToolCall'] | undefined = requestToolApproval ?
    ((call: ToolCall, tool: ToolDefinition) => requestToolApproval({ call, tool }) ?? Promise.resolve({ approved: false, reason: 'Missing approval port.' }))
  : undefined;

  return {
    onAgentLoopEvent,
    approveToolCall,
    notifyPreflightCompactionStatus(event) {
      args.onLegacyCompactionStatus?.(event);
      args.host?.compaction?.onPreflightCompactionStatus?.(event);
    },
    notifyFinalCompactionStatus(event) {
      args.onLegacyCompactionStatus?.(event);
      args.host?.compaction?.onFinalCompactionStatus?.(event);
    },
  };
}
