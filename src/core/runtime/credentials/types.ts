import type { LlmProvider } from '@/core/llm/types.js';

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
  | { type: 'local-endpoint'; provider: LlmProvider; baseUrl: string }
  | { type: 'missing'; provider: LlmProvider };
