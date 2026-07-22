import type { LlmAdapterCapabilities, LlmProvider } from '@/core/llm/types.js';
import type { ModelOptionSource } from '@/core/llm/models/model-catalog.js';

export type OpenAiCompatibleProviderId = Extract<
  LlmProvider,
  'kimi' | 'ollama' | 'lmstudio' | 'litellm' | 'vllm' | 'huggingface' | 'openrouter' | 'together' | 'groq'
>;

export type OpenAiCompatibleModelDiscoveryMode = 'ollama-tags' | 'openai-models';

export type OpenAiCompatibleProviderProfile = {
  id: OpenAiCompatibleProviderId;
  label: string;
  modelPrefix: string;
  modelPrefixAliases?: string[];
  defaultModelEnvName: string;
  endpoint: {
    defaultBaseUrl?: string;
    baseUrlEnvNames: string[];
    nativeBaseUrlEnvNames?: string[];
    apiKeyEnvNames: string[];
    requiresApiKey: boolean;
    local: boolean;
  };
  modelDiscovery: {
    label: string;
    mode: OpenAiCompatibleModelDiscoveryMode;
    source: ModelOptionSource;
  };
  capabilities: LlmAdapterCapabilities;
};

export type OpenAiCompatibleModelDiscoverySource = {
  profile: OpenAiCompatibleProviderProfile;
  baseUrl: string;
  nativeBaseUrl?: string;
  apiKey?: string;
};
