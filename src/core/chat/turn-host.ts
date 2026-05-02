import type { ToolCall, ToolDefinition } from '../../index.js';
import type { AgentLoopEvent } from '../runtime/agent-loop.js';
import type { PersistChatTurnCompactionStatus } from './session-turn-result.js';
import type { ChatTurnPreflightCompactionStatus } from './session-turn-preflight.js';
import type { ToolApprovalDecision } from '../approvals/types.js';

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
