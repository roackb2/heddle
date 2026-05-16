import type { LlmResponse, LlmUsage } from '@/core/llm/types.js';
import type { RunResult } from '@/core/types.js';
import type { AgentRunContext } from '../types.js';

export type RequestAgentModelTurnArgs = {
  context: AgentRunContext;
};

export type AgentModelTurnResult = LlmResponse | RunResult;

export type AccumulateAgentUsageArgs = {
  current?: LlmUsage;
  next?: LlmUsage;
};
