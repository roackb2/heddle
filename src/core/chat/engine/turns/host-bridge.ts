import type { ToolApprovalDecision } from '../../../approvals/types.js';
import type { RunAgentLoopOptions } from '../../../runtime/agent-loop.js';
import type { AgentLoopEvent } from '../../../runtime/events.js';
import type { ToolCall, ToolDefinition } from '../../../types.js';
import type { PersistChatTurnCompactionStatus } from './result.js';
import type { ChatTurnPreflightCompactionStatus } from './preflight.js';

export type ChatTurnApprovalRequest = {
  call: ToolCall;
  tool: ToolDefinition;
};

export interface ChatTurnEventPort {
  onAgentLoopEvent?(event: AgentLoopEvent): void;
}

export interface ChatTurnCompactionPort {
  onPreflightCompactionStatus?(event: ChatTurnPreflightCompactionStatus): void;
  onFinalCompactionStatus?(event: PersistChatTurnCompactionStatus): void;
}

export interface ChatTurnApprovalPort {
  requestToolApproval?(request: ChatTurnApprovalRequest): Promise<ToolApprovalDecision>;
}

export interface ChatTurnHostPort {
  events?: ChatTurnEventPort;
  compaction?: ChatTurnCompactionPort;
  approvals?: ChatTurnApprovalPort;
}

export type CreateChatTurnHostBridgeArgs = {
  host?: ChatTurnHostPort;
  onCompactionStatus?: (event: ChatTurnPreflightCompactionStatus | PersistChatTurnCompactionStatus) => void;
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
