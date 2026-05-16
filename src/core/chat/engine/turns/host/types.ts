import type { RunAgentLoopOptions } from '@/core/runtime/agent-loop.js';
import type { AgentLoopEvent } from '@/core/runtime/events.js';
import type { PersistChatTurnCompactionStatus } from '../persistence/index.js';
import type { ChatTurnPreflightCompactionStatus } from '../preflight/index.js';

export type ChatTurnCompactionPhase = 'preflight' | 'final';

export type ChatTurnCompactionStatus = ChatTurnPreflightCompactionStatus | PersistChatTurnCompactionStatus;

export type ChatTurnHostPort = {
  onAgentLoopEvent?: (event: AgentLoopEvent) => void;
  approveToolCall?: RunAgentLoopOptions['approveToolCall'];
  onCompactionStatus?: (event: ChatTurnCompactionStatus, phase: ChatTurnCompactionPhase) => void;
};

export type ConversationEngineHostAdapterResult = {
  turnHost?: ChatTurnHostPort;
  onAssistantStream?: RunAgentLoopOptions['onAssistantStream'];
  onTraceEvent?: RunAgentLoopOptions['onTraceEvent'];
};
