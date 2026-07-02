import type { RuntimeArtifact } from '@/core/artifacts/index.js';
import type { ToolCall, ToolResult } from '@/core/types.js';
import type { ChatSession } from '@/core/chat/types.js';

export type ConversationTurnToolResult = {
  call: ToolCall;
  result: ToolResult;
  durationMs?: number;
  step: number;
  timestamp: string;
};

export type ConversationTurnResultSummary = {
  outcome: string;
  summary: string;
  session: ChatSession;
  traceFile?: string;
  artifacts: RuntimeArtifact[];
  toolResults: ConversationTurnToolResult[];
};
