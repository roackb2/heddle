import type { RunFailure, StopReason, RunResult } from '@/core/types.js';
import type { LlmResponse } from '@/core/llm/types.js';
import type { AgentRunContext } from '../types.js';

export type FinishAgentRunLogging = {
  logLevel: 'info' | 'warn';
  logMessage: string;
};

export type FinishAgentRunOptions = {
  failure?: RunFailure;
  logging?: FinishAgentRunLogging;
};

export type FinishAgentRunArgs = {
  context: AgentRunContext;
  outcome: StopReason;
  summary: string;
  options?: FinishAgentRunOptions;
};

export type FinishAssistantResponseArgs = {
  context: AgentRunContext;
  response: LlmResponse;
};

export type MaybeFinishInterruptedArgs = {
  context: AgentRunContext;
  logMessage: string;
};

export type AgentRunFinishedValue = RunResult;
