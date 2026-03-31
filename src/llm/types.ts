// ---------------------------------------------------------------------------
// LLM Adapter — interface types
// ---------------------------------------------------------------------------

import type { AssistantDiagnostics, ToolCall, ToolDefinition } from '../types.js';

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
};

/**
 * Adapter interface — the loop talks to the LLM through this.
 * Swap implementations to change providers.
 */
export interface LlmAdapter {
  chat(messages: ChatMessage[], tools: ToolDefinition[], signal?: AbortSignal): Promise<LlmResponse>;
}
