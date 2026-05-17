import {
  ProviderCredentialRepository,
  type StoredProviderCredential,
} from '@/core/auth/index.js';
import { BuiltinLlmProviderRegistry } from './registry/index.js';
import type { LlmAdapter, LlmAdapterCreateInput, LlmProvider, LlmProviderResolutionInput } from './types.js';

/**
 * Main LLM application service. It is the public entry point for creating
 * provider adapters and resolving provider/model ownership.
 */
export class LlmAdapterService {
  private static readonly registry = BuiltinLlmProviderRegistry.create();

  static create(input: LlmAdapterCreateInput = {}): LlmAdapter {
    const provider = LlmAdapterService.resolveProvider(input);
    return LlmAdapterService.registry.createAdapter(
      LlmAdapterService.withStoredOAuthCredential(input, provider),
    );
  }

  static resolveProvider(input: LlmProviderResolutionInput = {}): LlmProvider {
    return LlmAdapterService.registry.resolveProvider(input).provider;
  }

  static inferProvider(model?: string): LlmProvider {
    return LlmAdapterService.registry.inferProvider(model);
  }

  private static withStoredOAuthCredential(input: LlmAdapterCreateInput, provider: LlmProvider): LlmAdapterCreateInput {
    const credentials = input.credentials;
    if (credentials?.credential || LlmAdapterService.hasApiKey(credentials?.apiKey)) {
      return input;
    }

    const credential = LlmAdapterService.resolveStoredOAuthCredential(provider, credentials?.credentialStorePath);
    if (!credential) {
      return input;
    }

    return {
      ...input,
      credentials: {
        ...(credentials ?? {}),
        credential,
      },
    };
  }

  private static resolveStoredOAuthCredential(
    provider: LlmProvider,
    storePath?: string,
  ): Extract<StoredProviderCredential, { type: 'oauth' }> | undefined {
    const credential = new ProviderCredentialRepository({ storePath }).get(provider);
    return credential?.type === 'oauth' ? credential : undefined;
  }

  private static hasApiKey(value: string | undefined): boolean {
    return typeof value === 'string' && value.trim().length > 0;
  }
}
