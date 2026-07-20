import type { LlmProvider } from '@/core/llm/types.js';
import type {
  ResolvedProviderCredential,
  RuntimeProviderCredential,
} from '@/core/auth/index.js';

export type ApiKeyRuntime = {
  apiKey?: string;
  apiKeyProvider?: LlmProvider | 'explicit';
  credential?: RuntimeProviderCredential;
  credentialStorePath?: string;
  preferApiKey?: boolean;
};

export type ProviderCredentialResolution = {
  provider: LlmProvider;
  apiKey?: string;
  credential?: ResolvedProviderCredential;
  source: ProviderCredentialSource;
};

export type ProviderCredentialSource =
  | { type: 'explicit-api-key' }
  | { type: 'env-api-key'; provider: LlmProvider }
  | { type: 'oauth'; provider: LlmProvider; accountId?: string; expiresAt?: number }
  | { type: 'oauth-access-token'; provider: 'openai'; accountId?: string; expiresAt: number }
  | { type: 'local-endpoint'; provider: LlmProvider; baseUrl: string }
  | { type: 'missing'; provider: LlmProvider };

export type {
  ResolvedProviderCredential,
  RuntimeProviderCredential,
};
