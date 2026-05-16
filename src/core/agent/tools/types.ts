import type { LlmResponse } from '@/core/llm/types.js';
import type { RunResult, ToolCall, ToolResult } from '@/core/types.js';
import type { AgentRunContext } from '../types.js';

export type HandleAgentToolTurnArgs = {
  context: AgentRunContext;
  response: LlmResponse;
};

export type ExecuteAgentToolTurnArgs = {
  context: AgentRunContext;
  call: ToolCall;
};

export type AgentToolTurnResult = RunResult | 'continue';

export type HandleAgentToolResultArgs = {
  context: AgentRunContext;
  effectiveCall: ToolCall;
  toolCallId: string;
  result: ToolResult;
};
