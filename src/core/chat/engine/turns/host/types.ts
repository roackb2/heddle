import type { ToolApprovalDecision } from '@/core/approvals/types.js';
import type { RunAgentLoopOptions } from '@/core/runtime/agent-loop.js';
import type { AgentLoopEvent } from '@/core/runtime/events.js';
import type { ToolCall, ToolDefinition } from '@/core/types.js';
import type { PersistChatTurnCompactionStatus } from '../persistence/index.js';
import type { ChatTurnPreflightCompactionStatus } from '../preflight/index.js';

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
