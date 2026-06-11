import type { LlmAdapterCapabilities, LlmProvider } from '@/core/llm/types.js';
import type { OpenAiCompatibleProviderId, OpenAiCompatibleProviderProfile } from './types.js';

const CHAT_COMPLETIONS_CAPABILITIES: LlmAdapterCapabilities = {
  toolCalls: true,
  systemMessages: true,
  reasoningSummaries: false,
  parallelToolCalls: false,
};

export const OPENAI_COMPATIBLE_PROVIDER_PROFILES: readonly OpenAiCompatibleProviderProfile[] = [
  {
    id: 'ollama',
    label: 'Ollama',
    modelPrefix: 'ollama',
    defaultModelEnvName: 'OLLAMA_MODEL',
    endpoint: {
      defaultBaseUrl: 'http://127.0.0.1:11434/v1',
      baseUrlEnvNames: ['OLLAMA_OPENAI_BASE_URL', 'OLLAMA_BASE_URL'],
      nativeBaseUrlEnvNames: ['OLLAMA_BASE_URL', 'OLLAMA_OPENAI_BASE_URL'],
      apiKeyEnvNames: [],
      requiresApiKey: false,
      local: true,
    },
    modelDiscovery: {
      label: 'Ollama · Installed local models',
      mode: 'ollama-tags',
      source: 'local-discovered',
    },
    capabilities: CHAT_COMPLETIONS_CAPABILITIES,
  },
  {
    id: 'lmstudio',
    label: 'LM Studio',
    modelPrefix: 'lmstudio',
    defaultModelEnvName: 'LMSTUDIO_MODEL',
    endpoint: {
      defaultBaseUrl: 'http://127.0.0.1:1234/v1',
      baseUrlEnvNames: ['LMSTUDIO_OPENAI_BASE_URL', 'LMSTUDIO_BASE_URL'],
      apiKeyEnvNames: ['LMSTUDIO_API_KEY'],
      requiresApiKey: false,
      local: true,
    },
    modelDiscovery: {
      label: 'LM Studio · Loaded local models',
      mode: 'openai-models',
      source: 'local-discovered',
    },
    capabilities: CHAT_COMPLETIONS_CAPABILITIES,
  },
  {
    id: 'litellm',
    label: 'LiteLLM',
    modelPrefix: 'litellm',
    defaultModelEnvName: 'LITELLM_MODEL',
    endpoint: {
      defaultBaseUrl: 'http://127.0.0.1:4000/v1',
      baseUrlEnvNames: ['LITELLM_OPENAI_BASE_URL', 'LITELLM_BASE_URL'],
      apiKeyEnvNames: ['LITELLM_API_KEY'],
      requiresApiKey: false,
      local: false,
    },
    modelDiscovery: {
      label: 'LiteLLM · Gateway models',
      mode: 'openai-models',
      source: 'remote-discovered',
    },
    capabilities: CHAT_COMPLETIONS_CAPABILITIES,
  },
  {
    id: 'vllm',
    label: 'vLLM',
    modelPrefix: 'vllm',
    defaultModelEnvName: 'VLLM_MODEL',
    endpoint: {
      defaultBaseUrl: 'http://127.0.0.1:8000/v1',
      baseUrlEnvNames: ['VLLM_OPENAI_BASE_URL', 'VLLM_BASE_URL'],
      apiKeyEnvNames: ['VLLM_API_KEY'],
      requiresApiKey: false,
      local: true,
    },
    modelDiscovery: {
      label: 'vLLM · Served local models',
      mode: 'openai-models',
      source: 'local-discovered',
    },
    capabilities: CHAT_COMPLETIONS_CAPABILITIES,
  },
  {
    id: 'huggingface',
    label: 'Hugging Face',
    modelPrefix: 'huggingface',
    modelPrefixAliases: ['hf'],
    defaultModelEnvName: 'HUGGINGFACE_MODEL',
    endpoint: {
      defaultBaseUrl: 'https://router.huggingface.co/v1',
      baseUrlEnvNames: ['HUGGINGFACE_OPENAI_BASE_URL', 'HF_OPENAI_BASE_URL'],
      apiKeyEnvNames: ['HF_TOKEN', 'HUGGINGFACE_API_KEY'],
      requiresApiKey: true,
      local: false,
    },
    modelDiscovery: {
      label: 'Hugging Face · Router models',
      mode: 'openai-models',
      source: 'remote-discovered',
    },
    capabilities: CHAT_COMPLETIONS_CAPABILITIES,
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    modelPrefix: 'openrouter',
    defaultModelEnvName: 'OPENROUTER_MODEL',
    endpoint: {
      defaultBaseUrl: 'https://openrouter.ai/api/v1',
      baseUrlEnvNames: ['OPENROUTER_OPENAI_BASE_URL', 'OPENROUTER_BASE_URL'],
      apiKeyEnvNames: ['OPENROUTER_API_KEY'],
      requiresApiKey: true,
      local: false,
    },
    modelDiscovery: {
      label: 'OpenRouter · Available models',
      mode: 'openai-models',
      source: 'remote-discovered',
    },
    capabilities: CHAT_COMPLETIONS_CAPABILITIES,
  },
  {
    id: 'together',
    label: 'Together AI',
    modelPrefix: 'together',
    defaultModelEnvName: 'TOGETHER_MODEL',
    endpoint: {
      defaultBaseUrl: 'https://api.together.ai/v1',
      baseUrlEnvNames: ['TOGETHER_OPENAI_BASE_URL', 'TOGETHER_BASE_URL'],
      apiKeyEnvNames: ['TOGETHER_API_KEY'],
      requiresApiKey: true,
      local: false,
    },
    modelDiscovery: {
      label: 'Together AI · Available models',
      mode: 'openai-models',
      source: 'remote-discovered',
    },
    capabilities: CHAT_COMPLETIONS_CAPABILITIES,
  },
  {
    id: 'groq',
    label: 'Groq',
    modelPrefix: 'groq',
    defaultModelEnvName: 'GROQ_MODEL',
    endpoint: {
      defaultBaseUrl: 'https://api.groq.com/openai/v1',
      baseUrlEnvNames: ['GROQ_OPENAI_BASE_URL', 'GROQ_BASE_URL'],
      apiKeyEnvNames: ['GROQ_API_KEY'],
      requiresApiKey: true,
      local: false,
    },
    modelDiscovery: {
      label: 'Groq · Available models',
      mode: 'openai-models',
      source: 'remote-discovered',
    },
    capabilities: CHAT_COMPLETIONS_CAPABILITIES,
  },
];

/**
 * Registry for OpenAI-compatible provider profiles. Profiles own provider
 * prefixes, default endpoint names, and discovery labels; runtime services own
 * reading environment values and passing concrete endpoints into adapters.
 */
export class OpenAiCompatibleProviderProfileService {
  private static readonly profilesById = new Map<OpenAiCompatibleProviderId, OpenAiCompatibleProviderProfile>(
    OPENAI_COMPATIBLE_PROVIDER_PROFILES.map((profile) => [profile.id, profile]),
  );

  static list(): readonly OpenAiCompatibleProviderProfile[] {
    return OPENAI_COMPATIBLE_PROVIDER_PROFILES;
  }

  static get(provider: OpenAiCompatibleProviderId): OpenAiCompatibleProviderProfile {
    const profile = OpenAiCompatibleProviderProfileService.profilesById.get(provider);
    if (!profile) {
      throw new Error(`OpenAI-compatible provider profile is not registered: ${provider}`);
    }
    return profile;
  }

  static maybeGet(provider: LlmProvider): OpenAiCompatibleProviderProfile | undefined {
    return OpenAiCompatibleProviderProfileService.profilesById.get(provider as OpenAiCompatibleProviderId);
  }

  static findByModel(model: string): OpenAiCompatibleProviderProfile | undefined {
    const normalized = model.trim().toLowerCase();
    return OPENAI_COMPATIBLE_PROVIDER_PROFILES.find((profile) =>
      OpenAiCompatibleProviderProfileService.prefixes(profile).some((prefix) =>
        normalized.startsWith(`${prefix}/`) || normalized.startsWith(`${prefix}:`)));
  }

  static prefixes(profile: Pick<OpenAiCompatibleProviderProfile, 'modelPrefix' | 'modelPrefixAliases'>): string[] {
    return [profile.modelPrefix, ...(profile.modelPrefixAliases ?? [])].map((prefix) => prefix.toLowerCase());
  }
}
