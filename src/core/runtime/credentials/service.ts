import {
  ProviderCredentialRepository,
  type StoredProviderCredential,
} from '@/core/auth/index.js';
import { LlmAdapterService } from '@/core/llm/index.js';
import type { LlmProvider } from '@/core/llm/types.js';
import type { ApiKeyRuntime, ProviderCredentialSource } from './types.js';

/**
 * Resolves runtime credential sources for provider-backed agent execution.
 */
export class RuntimeCredentialService {
  static readonly DEFAULT_OLLAMA_OPENAI_BASE_URL = 'http://127.0.0.1:11434/v1';

  static resolveProviderApiKey(provider: LlmProvider): string | undefined {
    switch (provider) {
      case 'openai':
        return this.firstDefinedNonEmpty(process.env.OPENAI_API_KEY, process.env.PERSONAL_OPENAI_API_KEY);
      case 'anthropic':
        return this.firstDefinedNonEmpty(process.env.ANTHROPIC_API_KEY, process.env.PERSONAL_ANTHROPIC_API_KEY);
      case 'google':
      case 'ollama':
      case 'huggingface':
        return undefined;
    }
  }

  static resolveApiKeyForModel(model: string, runtime?: ApiKeyRuntime): string | undefined {
    const source = this.resolveCredentialSourceForModel(model, runtime);

    if (source.type === 'local-endpoint') {
      return undefined;
    }

    if (source.type === 'explicit-api-key') {
      return runtime?.apiKey;
    }

    if (source.type === 'env-api-key') {
      return runtime?.apiKey && runtime.apiKeyProvider === source.provider ?
          runtime.apiKey
        : this.resolveProviderApiKey(source.provider);
    }

    return undefined;
  }

  static resolveOAuthCredentialForModel(
    model: string,
    options: { storePath?: string } = {},
  ): Extract<StoredProviderCredential, { type: 'oauth' }> | undefined {
    const provider = LlmAdapterService.inferProvider(model);
    const credential = new ProviderCredentialRepository({ storePath: options.storePath }).get(provider);
    return credential?.type === 'oauth' ? credential : undefined;
  }

  static hasCredentialForModel(
    model: string,
    runtime?: ApiKeyRuntime & { credentialStorePath?: string },
  ): boolean {
    return this.resolveCredentialSourceForModel(model, runtime).type !== 'missing';
  }

  static resolveCredentialSourceForModel(
    model: string,
    runtime?: ApiKeyRuntime,
  ): ProviderCredentialSource {
    const provider = LlmAdapterService.inferProvider(model);
    const localEndpointSource = this.resolveLocalEndpointCredentialSource(provider);
    if (localEndpointSource) {
      return localEndpointSource;
    }

    if (runtime?.apiKey && runtime.apiKeyProvider === 'explicit') {
      return { type: 'explicit-api-key' };
    }

    if (runtime?.preferApiKey) {
      if (runtime.apiKey && runtime.apiKeyProvider === provider) {
        return { type: 'env-api-key', provider };
      }

      const preferredApiKey = this.resolveProviderApiKey(provider);
      if (preferredApiKey) {
        return { type: 'env-api-key', provider };
      }
    }

    const oauthCredential = this.resolveOAuthCredentialForModel(model, { storePath: runtime?.credentialStorePath });
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

    const apiKey = this.resolveProviderApiKey(provider);
    if (apiKey) {
      return { type: 'env-api-key', provider };
    }

    return { type: 'missing', provider };
  }

  static resolveLocalEndpointCredentialSource(provider: LlmProvider): Extract<ProviderCredentialSource, { type: 'local-endpoint' }> | undefined {
    if (provider !== 'ollama') {
      return undefined;
    }

    return {
      type: 'local-endpoint',
      provider,
      baseUrl: RuntimeCredentialService.resolveOllamaOpenAiBaseUrl(),
    };
  }

  static formatMissingCredentialMessage(model: string): string {
    const provider = LlmAdapterService.inferProvider(model);
    if (provider === 'openai') {
      return 'Missing OpenAI credential. Run `heddle auth login openai` to use OpenAI account sign-in, or set OPENAI_API_KEY for Platform API-key mode.';
    }

    if (provider === 'anthropic') {
      return 'Missing Anthropic credential. Set ANTHROPIC_API_KEY for Anthropic models.';
    }

    return `Missing provider credential for ${provider}.`;
  }

  private static firstDefinedNonEmpty(...values: Array<string | undefined>): string | undefined {
    return values.find((value) => typeof value === 'string' && value.trim().length > 0);
  }

  private static resolveOllamaOpenAiBaseUrl(): string {
    const configured = RuntimeCredentialService.firstDefinedNonEmpty(
      process.env.OLLAMA_OPENAI_BASE_URL,
      process.env.OLLAMA_BASE_URL,
    );
    if (!configured) {
      return RuntimeCredentialService.DEFAULT_OLLAMA_OPENAI_BASE_URL;
    }

    const trimmed = configured.replace(/\/+$/, '');
    return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
  }
}
