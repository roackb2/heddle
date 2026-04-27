import type { LlmProvider } from '../llm/types.js';
import { inferProviderFromModel } from '../llm/providers.js';
import {
  getStoredProviderCredential,
  type StoredProviderCredential,
} from '../auth/provider-credentials.js';

export type ApiKeyRuntime = {
  apiKey?: string;
  apiKeyProvider?: LlmProvider | 'explicit';
  credentialStorePath?: string;
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
  if (resolveOAuthCredentialForModel(model, { storePath: runtime?.credentialStorePath })) {
    return undefined;
  }

  if (runtime?.apiKey && runtime.apiKeyProvider === provider) {
    return runtime.apiKey;
  }

  return resolveProviderApiKey(provider);
}

export function resolveOAuthCredentialForModel(
  model: string,
  options: { storePath?: string } = {},
): Extract<StoredProviderCredential, { type: 'oauth' }> | undefined {
  const provider = inferProviderFromModel(model);
  const credential = getStoredProviderCredential(provider, options.storePath);
  return credential?.type === 'oauth' ? credential : undefined;
}

export function hasProviderCredentialForModel(
  model: string,
  runtime?: ApiKeyRuntime & { credentialStorePath?: string },
): boolean {
  return Boolean(resolveApiKeyForModel(model, runtime) ?? resolveOAuthCredentialForModel(model, {
    storePath: runtime?.credentialStorePath,
  }));
}

function firstDefinedNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => typeof value === 'string' && value.trim().length > 0);
}
