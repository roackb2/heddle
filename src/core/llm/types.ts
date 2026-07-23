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
  // User-facing assistant work narration. Provider adapters must derive this
  // from an explicit provider discriminator (OpenAI/Codex uses message
  // `phase: 'commentary'`), never from the text itself.
  | { type: 'commentary.delta'; messageId: string; delta: string }
  | { type: 'commentary.done'; messageId: string; text: string }
  | { type: 'reasoning_summary.delta'; delta: string }
  | { type: 'reasoning_summary.done'; text: string };

export const LLM_PROVIDERS = [
  'openai',
  'anthropic',
  'google',
  'kimi',
  'ollama',
  'lmstudio',
  'litellm',
  'vllm',
  'huggingface',
  'openrouter',
  'together',
  'groq',
] as const;

export type LlmProvider = (typeof LLM_PROVIDERS)[number];

export const REASONING_EFFORTS = [
  'none',
  'low',
  'medium',
  'high',
  'ultrahigh',
  'max',
] as const;

export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

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

export type LlmUsageCost =
  | { status: 'reported'; amountUsd: number }
  | { status: 'partial'; reportedAmountUsd: number; unavailableRequests: number }
  | { status: 'unavailable' };

export type LlmModelUsage = {
  provider: LlmProvider;
  model: string;
  inputTokens: number;
  billedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens?: number;
  cacheWriteInputTokens?: number;
  reasoningTokens?: number;
  requests: number;
  cost: LlmUsageCost;
};

export type LlmUsage = {
  /**
   * All model input tokens, including cache reads and cache writes.
   */
  inputTokens: number;
  /**
   * Regular provider input tokens, excluding separately reported cache reads
   * and cache writes.
   */
  billedInputTokens?: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens?: number;
  cacheWriteInputTokens?: number;
  reasoningTokens?: number;
  requests?: number;
  cost?: LlmUsageCost;
  byModel?: LlmModelUsage[];
  unattributedRequests?: number;
};

/**
 * Provider-private assistant state that must be replayed to the same provider.
 *
 * This state is part of the durable model-facing transcript, but it is not a
 * user-facing reasoning summary. Hosts, traces, and presentation layers must
 * not render or log it as assistant work narration.
 */
export type AssistantProviderContinuation =
  | { provider: 'kimi'; reasoningContent: string };

/**
 * A message in the chat transcript.
 */
export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | {
    role: 'assistant';
    content: string;
    toolCalls?: ToolCall[];
    providerContinuation?: AssistantProviderContinuation;
  }
  | { role: 'tool'; content: string; toolCallId: string };

/**
 * What the LLM returns after a chat turn.
 */
export type LlmResponse = {
  content?: string;
  diagnostics?: AssistantDiagnostics;
  toolCalls?: ToolCall[];
  providerContinuation?: AssistantProviderContinuation;
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
