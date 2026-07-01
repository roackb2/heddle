import type { LlmProvider } from '@/core/llm/types.js';

export type StoredProviderCredential =
  | {
      type: 'api-key';
      provider: LlmProvider;
      key: string;
      createdAt: string;
      updatedAt: string;
      label?: string;
    }
  | {
      type: 'bearer';
      provider: LlmProvider;
      token: string;
      createdAt: string;
      updatedAt: string;
      label?: string;
    }
  | {
      type: 'oauth';
      provider: LlmProvider;
      accessToken: string;
      refreshToken: string;
      expiresAt: number;
      createdAt: string;
      updatedAt: string;
      accountId?: string;
      label?: string;
    };

export type ProviderCredentialStore = {
  version: 1;
  credentials: Partial<Record<LlmProvider, StoredProviderCredential>>;
};

export type ProviderCredentialSummary = {
  provider: LlmProvider;
  type: StoredProviderCredential['type'];
  label?: string;
  accountId?: string;
  expiresAt?: number;
  expired?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PkceCodes = {
  verifier: string;
  challenge: string;
};

export type OpenAiOAuthTokenResponse = {
  id_token?: string;
  access_token: string;
  refresh_token: string;
  expires_in?: number;
};

export type OpenAiOAuthCredential = Extract<StoredProviderCredential, { type: 'oauth' }>;

export type OpenAiOAuthLoginOptions = {
  port?: number;
  openBrowser?: boolean;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  openUrl?: (url: string) => Promise<void> | void;
  onAuthorizeUrl?: (url: string) => void;
};

export type OpenAiOAuthRefreshOptions = {
  refreshToken: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
};

export type OpenAiIdTokenClaims = {
  chatgpt_account_id?: string;
  organizations?: Array<{ id?: string }>;
  'https://api.openai.com/auth'?: {
    chatgpt_account_id?: string;
  };
};

export type OpenAiOAuthCallbackServer = {
  redirectUri: string;
  tokens: Promise<OpenAiOAuthTokenResponse>;
  close: () => Promise<void>;
};
