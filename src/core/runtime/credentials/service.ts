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
import type {
  ApiKeyRuntime,
  ProviderCredentialResolution,
  ProviderCredentialSource,
  RuntimeProviderCredential,
} from './types.js';

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
      case 'kimi':
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
    return this.resolveForModel(model, runtime).apiKey;
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
    return this.resolveForModel(model, runtime).source.type !== 'missing';
  }

  static resolveCredentialSourceForModel(
    model: string,
    runtime?: ApiKeyRuntime,
  ): ProviderCredentialSource {
    return this.resolveForModel(model, runtime).source;
  }

  /** Resolves one concrete credential principal for a model-backed runtime. */
  static resolveForModel(
    model: string,
    runtime?: ApiKeyRuntime,
  ): ProviderCredentialResolution {
    const provider = LlmAdapterService.inferProvider(model);
    RuntimeCredentialService.assertRuntimeCredential({
      apiKey: runtime?.apiKey,
      credential: runtime?.credential,
      provider,
    });
    const localEndpointSource = this.resolveLocalEndpointCredentialSource(provider);
    if (localEndpointSource) {
      return { provider, source: localEndpointSource };
    }

    if (runtime?.credential) {
      return {
        provider,
        credential: runtime.credential,
        source: {
          type: 'oauth-access-token',
          provider: runtime.credential.provider,
          accountId: runtime.credential.accountId,
          expiresAt: runtime.credential.expiresAt,
        },
      };
    }

    if (runtime?.apiKey && runtime.apiKeyProvider === 'explicit') {
      return {
        provider,
        apiKey: runtime.apiKey,
        source: { type: 'explicit-api-key' },
      };
    }

    if (runtime?.preferApiKey) {
      if (runtime.apiKey && runtime.apiKeyProvider === provider) {
        return {
          provider,
          apiKey: runtime.apiKey,
          source: { type: 'env-api-key', provider },
        };
      }

      const preferredApiKey = this.resolveProviderApiKey(provider);
      if (preferredApiKey) {
        return {
          provider,
          apiKey: preferredApiKey,
          source: { type: 'env-api-key', provider },
        };
      }
    }

    const oauthCredential = this.resolveOAuthCredentialForModel(model, { storePath: runtime?.credentialStorePath });
    if (oauthCredential) {
      return {
        provider,
        credential: oauthCredential,
        source: {
          type: 'oauth',
          provider: oauthCredential.provider,
          accountId: oauthCredential.accountId,
          expiresAt: oauthCredential.expiresAt,
        },
      };
    }

    if (runtime?.apiKey && runtime.apiKeyProvider === provider) {
      return {
        provider,
        apiKey: runtime.apiKey,
        source: { type: 'env-api-key', provider },
      };
    }

    const apiKey = this.resolveProviderApiKey(provider);
    if (apiKey) {
      return {
        provider,
        apiKey,
        source: { type: 'env-api-key', provider },
      };
    }

    return {
      provider,
      source: { type: 'missing', provider },
    };
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

    if (provider === 'kimi') {
      return 'Missing Kimi Platform credential. Set MOONSHOT_API_KEY (or KIMI_PLATFORM_API_KEY) to a Kimi Platform API key. Kimi Code membership keys use a separate service and are not supported by this provider.';
    }

    return `Missing provider credential for ${provider}.`;
  }

  static formatCredentialSource(source: ProviderCredentialSource): string {
    switch (source.type) {
      case 'explicit-api-key':
        return 'explicit API key';
      case 'env-api-key':
        return `${source.provider} API key from environment`;
      case 'oauth':
        return source.accountId ? `${source.provider} OAuth account ${source.accountId}` : `${source.provider} OAuth account`;
      case 'oauth-access-token':
        return source.accountId ? `${source.provider} request-scoped OAuth account ${source.accountId}` : `${source.provider} request-scoped OAuth access token`;
      case 'local-endpoint':
        return `${source.provider} local endpoint ${source.baseUrl}`;
      case 'missing':
        return `missing ${source.provider} credential`;
    }
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

  private static assertRuntimeCredential(args: {
    apiKey?: string;
    credential?: RuntimeProviderCredential;
    provider: LlmProvider;
  }): void {
    if (!args.credential) {
      return;
    }

    if (args.apiKey?.trim()) {
      throw new Error('Provide either apiKey or credential for one runtime, not both.');
    }
    if (args.credential.provider !== args.provider) {
      throw new Error(`Runtime credential provider ${args.credential.provider} does not match model provider ${args.provider}.`);
    }
    if (!args.credential.accessToken.trim()) {
      throw new Error('Runtime OAuth access token cannot be empty.');
    }
    if (!Number.isFinite(args.credential.expiresAt)) {
      throw new Error('Runtime OAuth access token expiry must be a finite Unix timestamp in milliseconds.');
    }
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
