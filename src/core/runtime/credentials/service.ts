import {
  ProviderCredentialRepository,
  type StoredProviderCredential,
} from '@/core/auth/index.js';
import {
  LlmAdapterService,
  OpenAiCompatibleProviderProfileService,
  type OpenAiCompatibleModelDiscoverySource,
  type OpenAiCompatibleProviderProfile,
} from '@/core/llm/index.js';
import type { LlmProvider, LlmProviderEndpointRuntime } from '@/core/llm/types.js';
import type { ApiKeyRuntime, ProviderCredentialSource } from './types.js';

/**
 * Resolves runtime credential sources for provider-backed agent execution.
 */
export class RuntimeCredentialService {
  static readonly DEFAULT_OLLAMA_OPENAI_BASE_URL = 'http://127.0.0.1:11434/v1';
  static readonly DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434';

  static resolveProviderApiKey(provider: LlmProvider): string | undefined {
    const compatibleProfile = OpenAiCompatibleProviderProfileService.maybeGet(provider);
    if (compatibleProfile) {
      return this.firstDefinedNonEmpty(...compatibleProfile.endpoint.apiKeyEnvNames.map((name) => process.env[name]));
    }

    switch (provider) {
      case 'openai':
        return this.firstDefinedNonEmpty(process.env.OPENAI_API_KEY, process.env.PERSONAL_OPENAI_API_KEY);
      case 'anthropic':
        return this.firstDefinedNonEmpty(process.env.ANTHROPIC_API_KEY, process.env.PERSONAL_ANTHROPIC_API_KEY);
      case 'google':
      case 'ollama':
      case 'lmstudio':
      case 'litellm':
      case 'vllm':
      case 'huggingface':
      case 'openrouter':
      case 'together':
      case 'groq':
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
    const profile = OpenAiCompatibleProviderProfileService.maybeGet(provider);
    if (!profile || profile.endpoint.requiresApiKey) {
      return undefined;
    }

    return {
      type: 'local-endpoint',
      provider,
      baseUrl: RuntimeCredentialService.resolveOpenAiCompatibleBaseUrl(profile),
    };
  }

  static resolveOpenAiCompatibleEndpointRuntime(provider: LlmProvider, runtime?: ApiKeyRuntime): LlmProviderEndpointRuntime | undefined {
    const profile = OpenAiCompatibleProviderProfileService.maybeGet(provider);
    if (!profile) {
      return undefined;
    }

    const apiKey = RuntimeCredentialService.resolveEndpointApiKey(provider, runtime);
    return {
      baseUrl: RuntimeCredentialService.resolveOpenAiCompatibleBaseUrl(profile),
      auth: apiKey ? { type: 'bearer', token: apiKey } : { type: 'none' },
    };
  }

  static resolveOpenAiCompatibleModelDiscoverySources(): OpenAiCompatibleModelDiscoverySource[] {
    return OpenAiCompatibleProviderProfileService.list().flatMap((profile) => {
      const apiKey = RuntimeCredentialService.resolveProviderApiKey(profile.id);
      if (profile.endpoint.requiresApiKey && !apiKey) {
        return [];
      }

      return [{
        profile,
        baseUrl: RuntimeCredentialService.resolveOpenAiCompatibleBaseUrl(profile),
        nativeBaseUrl: RuntimeCredentialService.resolveOpenAiCompatibleNativeBaseUrl(profile),
        apiKey,
      }];
    });
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

  static resolveOllamaBaseUrl(): string {
    return RuntimeCredentialService.resolveOpenAiCompatibleNativeBaseUrl(
      OpenAiCompatibleProviderProfileService.get('ollama'),
    ) ?? RuntimeCredentialService.DEFAULT_OLLAMA_BASE_URL;
  }

  static resolveOllamaOpenAiBaseUrl(): string {
    return RuntimeCredentialService.resolveOpenAiCompatibleBaseUrl(
      OpenAiCompatibleProviderProfileService.get('ollama'),
    );
  }

  private static resolveEndpointApiKey(provider: LlmProvider, runtime?: ApiKeyRuntime): string | undefined {
    if (runtime?.apiKey && (runtime.apiKeyProvider === 'explicit' || runtime.apiKeyProvider === provider)) {
      return runtime.apiKey;
    }

    return RuntimeCredentialService.resolveProviderApiKey(provider);
  }

  private static resolveOpenAiCompatibleBaseUrl(profile: OpenAiCompatibleProviderProfile): string {
    const configured = RuntimeCredentialService.firstDefinedNonEmpty(
      ...profile.endpoint.baseUrlEnvNames.map((name) => process.env[name]),
    );
    const value = configured ?? profile.endpoint.defaultBaseUrl;
    if (!value) {
      throw new Error(`${profile.label} OpenAI-compatible base URL is required. Set one of ${profile.endpoint.baseUrlEnvNames.join(', ')}.`);
    }

    const trimmed = value.replace(/\/+$/, '');
    return trimmed.endsWith('/v1') || trimmed.endsWith('/api/v1') || trimmed.endsWith('/openai/v1') ? trimmed : `${trimmed}/v1`;
  }

  private static resolveOpenAiCompatibleNativeBaseUrl(profile: OpenAiCompatibleProviderProfile): string | undefined {
    const configured = RuntimeCredentialService.firstDefinedNonEmpty(
      ...(profile.endpoint.nativeBaseUrlEnvNames ?? profile.endpoint.baseUrlEnvNames).map((name) => process.env[name]),
    );
    const value = configured ?? profile.endpoint.defaultBaseUrl;
    return value?.replace(/\/+$/, '').replace(/\/v1$/i, '');
  }
}
