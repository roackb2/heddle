// ---------------------------------------------------------------------------
// LLM Adapter — interface types
// ---------------------------------------------------------------------------

import type { AssistantDiagnostics, ToolCall, ToolDefinition } from '../types.js';
import type {
  RuntimeProviderCredential,
  StoredProviderCredential,
} from '@/core/auth/index.js';

export type LlmStreamEvent =
  | { type: 'content.delta'; delta: string }
  | { type: 'content.done'; content: string }
  | { type: 'reasoning_summary.delta'; delta: string }
  | { type: 'reasoning_summary.done'; text: string };

export type LlmProvider =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'ollama'
  | 'lmstudio'
  | 'litellm'
  | 'vllm'
  | 'huggingface'
  | 'openrouter'
  | 'together'
  | 'groq';

export type ReasoningEffort = 'low' | 'medium' | 'high' | 'ultrahigh';

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
  chat(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    signal?: AbortSignal,
    onStreamEvent?: (event: LlmStreamEvent) => void,
  ): Promise<LlmResponse>;
}

export type LlmCredentialContext = {
  apiKey?: string;
  credential?: StoredProviderCredential | RuntimeProviderCredential;
  credentialStorePath?: string;
};

export type LlmProviderEndpointAuth =
  | { type: 'none' }
  | { type: 'bearer'; token: string };

export type LlmProviderEndpointRuntime = {
  baseUrl: string;
  auth: LlmProviderEndpointAuth;
  timeoutMs?: number;
};

export type LlmRuntimeContext = {
  reasoningEffort?: ReasoningEffort;
  fetchImpl?: (url: unknown, init?: unknown) => Promise<globalThis.Response>;
  endpoint?: LlmProviderEndpointRuntime;
};

export type LlmAdapterCreateInput = {
  provider?: LlmProvider;
  model?: string;
  credentials?: LlmCredentialContext;
  runtime?: LlmRuntimeContext;
};

export type LlmProviderResolutionInput = Pick<LlmAdapterCreateInput, 'provider' | 'model'>;
