// ---------------------------------------------------------------------------
// LLM Adapter — interface types
// ---------------------------------------------------------------------------

import type { AssistantDiagnostics, ToolCall, ToolDefinition } from '../types.js';

export type LlmProvider = 'openai' | 'anthropic' | 'google';

export type LlmAdapterCapabilities = {
  toolCalls: boolean;
  systemMessages: boolean;
  reasoningSummaries: boolean;
  parallelToolCalls: boolean;
};

export type LlmAdapterInfo = {
  provider: LlmProvider;
  model: string;
  capabilities: LlmAdapterCapabilities;
};

export type LlmUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
  requests?: number;
};

/**
 * A message in the chat transcript.
 */
export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; content: string; toolCallId: string };

/**
 * What the LLM returns after a chat turn.
 */
export type LlmResponse = {
  content?: string;
  diagnostics?: AssistantDiagnostics;
  toolCalls?: ToolCall[];
  usage?: LlmUsage;
};

/**
 * Adapter interface — the loop talks to the LLM through this.
 * Swap implementations to change providers.
 */
export interface LlmAdapter {
  info?: LlmAdapterInfo;
  chat(messages: ChatMessage[], tools: ToolDefinition[], signal?: AbortSignal): Promise<LlmResponse>;
}
