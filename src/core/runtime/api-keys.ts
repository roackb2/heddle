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
  preferApiKey?: boolean;
};

export type ProviderCredentialSource =
  | { type: 'explicit-api-key' }
  | { type: 'env-api-key'; provider: LlmProvider }
  | { type: 'oauth'; provider: LlmProvider; accountId?: string; expiresAt?: number }
  | { type: 'missing'; provider: LlmProvider };

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
  const source = resolveProviderCredentialSourceForModel(model, runtime);

  if (source.type === 'explicit-api-key') {
    return runtime?.apiKey;
  }

  if (source.type === 'env-api-key') {
    return runtime?.apiKey && runtime.apiKeyProvider === source.provider ?
        runtime.apiKey
      : resolveProviderApiKey(source.provider);
  }

  return undefined;
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
  return resolveProviderCredentialSourceForModel(model, runtime).type !== 'missing';
}

export function resolveProviderCredentialSourceForModel(
  model: string,
  runtime?: ApiKeyRuntime,
): ProviderCredentialSource {
  const provider = inferProviderFromModel(model);
  if (runtime?.apiKey && runtime.apiKeyProvider === 'explicit') {
    return { type: 'explicit-api-key' };
  }

  if (runtime?.preferApiKey) {
    if (runtime.apiKey && runtime.apiKeyProvider === provider) {
      return { type: 'env-api-key', provider };
    }

    const preferredApiKey = resolveProviderApiKey(provider);
    if (preferredApiKey) {
      return { type: 'env-api-key', provider };
    }
  }

  const oauthCredential = resolveOAuthCredentialForModel(model, { storePath: runtime?.credentialStorePath });
  if (oauthCredential) {
    return {
      type: 'oauth',
      provider: oauthCredential.provider,
      accountId: oauthCredential.accountId,
      expiresAt: oauthCredential.expiresAt,
    };
  }

  if (runtime?.apiKey && runtime.apiKeyProvider === provider) {
    return { type: 'env-api-key', provider };
  }

  const apiKey = resolveProviderApiKey(provider);
  if (apiKey) {
    return { type: 'env-api-key', provider };
  }

  return { type: 'missing', provider };
}

export function formatMissingProviderCredentialMessage(model: string): string {
  const provider = inferProviderFromModel(model);
  if (provider === 'openai') {
    return 'Missing OpenAI credential. Run `heddle auth login openai` to use OpenAI account sign-in, or set OPENAI_API_KEY for Platform API-key mode.';
  }

  if (provider === 'anthropic') {
    return 'Missing Anthropic credential. Set ANTHROPIC_API_KEY for Anthropic models.';
  }

  return `Missing provider credential for ${provider}.`;
}

function firstDefinedNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => typeof value === 'string' && value.trim().length > 0);
}
