import type { LlmProvider } from '../../llm/types.js';
import { inferProviderFromModel } from '../../llm/providers.js';

export type ApiKeyRuntime = {
  apiKey?: string;
  apiKeyProvider?: LlmProvider | 'explicit';
};

export function resolveProviderApiKey(provider: LlmProvider): string | undefined {
  switch (provider) {
    case 'openai':
      return firstDefinedNonEmpty(process.env.OPENAI_API_KEY, process.env.PERSONAL_OPENAI_API_KEY);
    case 'anthropic':
      return firstDefinedNonEmpty(process.env.ANTHROPIC_API_KEY, process.env.PERSONAL_ANTHROPIC_API_KEY);
    case 'google':
      return undefined;
  }
}

export function resolveApiKeyForModel(model: string, runtime?: ApiKeyRuntime): string | undefined {
  if (runtime?.apiKey && runtime.apiKeyProvider === 'explicit') {
    return runtime.apiKey;
  }

  const provider = inferProviderFromModel(model);
  if (runtime?.apiKey && runtime.apiKeyProvider === provider) {
    return runtime.apiKey;
  }

  return resolveProviderApiKey(provider);
}

function firstDefinedNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => typeof value === 'string' && value.trim().length > 0);
}
