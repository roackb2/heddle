import type { LlmProvider, LlmRuntimeContext, ReasoningEffort } from '@/core/llm/types.js';
import type { ApiKeyRuntime, ProviderCredentialSource } from '../credentials/index.js';

export type LlmProviderRuntimeInput = ApiKeyRuntime & {
  model: string;
  reasoningEffort?: ReasoningEffort;
};

export type LlmProviderRuntimeResolution = {
  model: string;
  provider: LlmProvider;
  apiKey: string | undefined;
  credentialSource: ProviderCredentialSource;
  llmRuntime: LlmRuntimeContext;
};
