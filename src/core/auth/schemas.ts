import { z } from 'zod';
import type { LlmProvider } from '@/core/llm/types.js';
import type { ProviderCredentialStore, StoredProviderCredential } from './types.js';

const providerSchema = z.enum([
  'openai',
  'anthropic',
  'google',
  'ollama',
  'lmstudio',
  'litellm',
  'vllm',
  'huggingface',
  'openrouter',
  'together',
  'groq',
])
  .describe('LLM provider that owns this stored credential.');

const credentialBaseSchema = z.object({
  provider: providerSchema,
  createdAt: z.string().min(1).describe('ISO timestamp for the first time this credential was stored.'),
  updatedAt: z.string().min(1).describe('ISO timestamp for the last credential update.'),
  label: z.string().min(1).optional().describe('Human-readable credential label for status output.'),
});

export const storedProviderCredentialSchema = z.discriminatedUnion('type', [
  credentialBaseSchema.extend({
    type: z.literal('api-key').describe('Static provider API-key credential.'),
    key: z.string().min(1).describe('Provider API key secret.'),
  }),
  credentialBaseSchema.extend({
    type: z.literal('bearer').describe('Static bearer token credential.'),
    token: z.string().min(1).describe('Provider bearer token secret.'),
  }),
  credentialBaseSchema.extend({
    type: z.literal('oauth').describe('OAuth account sign-in credential.'),
    accessToken: z.string().min(1).describe('OAuth access token secret.'),
    refreshToken: z.string().min(1).describe('OAuth refresh token secret.'),
    expiresAt: z.number().finite().describe('Access token expiry as epoch milliseconds.'),
    accountId: z.string().min(1).optional().describe('Provider account identifier, when available.'),
  }),
]) satisfies z.ZodType<StoredProviderCredential>;

export const providerCredentialStoreSchema = z.object({
  version: z.literal(1).describe('Credential store schema version.'),
  credentials: z.record(providerSchema, z.unknown()).describe('Credentials keyed by provider.'),
}).describe('Persisted Heddle provider credential store.');

export class ProviderCredentialSchemas {
  static parseStore(input: unknown): ProviderCredentialStore {
    const parsed = providerCredentialStoreSchema.safeParse(input);
    if (!parsed.success) {
      return ProviderCredentialSchemas.emptyStore();
    }

    const credentials: ProviderCredentialStore['credentials'] = {};
    for (const [provider, value] of Object.entries(parsed.data.credentials)) {
      const credential = ProviderCredentialSchemas.parseCredential(provider as LlmProvider, value);
      if (credential) {
        credentials[provider as LlmProvider] = credential;
      }
    }

    return {
      version: 1,
      credentials,
    };
  }

  static parseCredential(provider: LlmProvider, input: unknown): StoredProviderCredential | undefined {
    const parsed = storedProviderCredentialSchema.safeParse(input);
    if (!parsed.success || parsed.data.provider !== provider) {
      return undefined;
    }
    return parsed.data;
  }

  static emptyStore(): ProviderCredentialStore {
    return {
      version: 1,
      credentials: {},
    };
  }
}
