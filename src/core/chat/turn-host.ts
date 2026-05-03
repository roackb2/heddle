import type { ToolApprovalDecision } from '../approvals/types.js';
import type { RunAgentLoopOptions } from '../runtime/agent-loop.js';
import type { AgentLoopEvent } from '../runtime/events.js';
import type { ToolCall, ToolDefinition } from '../types.js';
import type { PersistChatTurnCompactionStatus } from './session-turn-result.js';
import type { ChatTurnPreflightCompactionStatus } from './session-turn-preflight.js';

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

export type NormalizedChatTurnHost = {
  onAgentLoopEvent?: AgentLoopEventHandler;
  approveToolCall?: RunAgentLoopOptions['approveToolCall'];
  onPreflightCompactionStatus?: (event: ChatTurnPreflightCompactionStatus) => void;
  onFinalCompactionStatus?: (event: PersistChatTurnCompactionStatus) => void;
};

export function normalizeChatTurnHost(host: ChatTurnHostPort | undefined): NormalizedChatTurnHost {
  const onAgentLoopEvent = host?.events?.onAgentLoopEvent;
  const requestToolApproval = host?.approvals?.requestToolApproval;
  const approveToolCall: RunAgentLoopOptions['approveToolCall'] | undefined = requestToolApproval ?
    ((call: ToolCall, tool: ToolDefinition) => requestToolApproval({ call, tool }) ?? Promise.resolve({ approved: false, reason: 'Missing approval port.' }))
  : undefined;

  return {
    onAgentLoopEvent,
    approveToolCall,
    onPreflightCompactionStatus: host?.compaction?.onPreflightCompactionStatus,
    onFinalCompactionStatus: host?.compaction?.onFinalCompactionStatus,
  };
}

type AgentLoopEventHandler = (event: AgentLoopEvent) => void;
