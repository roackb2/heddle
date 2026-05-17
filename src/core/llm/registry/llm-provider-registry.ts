import type { LlmAdapter, LlmAdapterCreateInput, LlmProvider, LlmProviderResolutionInput } from '../types.js';
import { LlmProviderInference } from './provider-inference.js';
import type { LlmProviderAdapter, LlmProviderRegistryInput } from './types.js';

/**
 * Resolves model/provider requests to concrete provider adapters. The agent
 * loop depends on the LLM port; this registry is the provider adapter boundary.
 */
export class LlmProviderRegistry {
  private readonly providersById = new Map<LlmProvider, LlmProviderAdapter>();
  private readonly providers: readonly LlmProviderAdapter[];
  private readonly defaultProvider: LlmProvider;

  constructor(input: LlmProviderRegistryInput) {
    this.providers = input.providers;
    this.defaultProvider = input.defaultProvider;

    for (const provider of input.providers) {
      if (this.providersById.has(provider.provider)) {
        throw new Error(`Duplicate LLM provider adapter: ${provider.provider}`);
      }
      this.providersById.set(provider.provider, provider);
    }
  }

  resolveProvider(input: LlmProviderResolutionInput = {}): LlmProviderAdapter {
    const provider = input.provider ?? LlmProviderInference.infer({
      model: input.model,
      providers: this.providers,
      defaultProvider: this.defaultProvider,
    });
    const adapter = this.providersById.get(provider);
    if (!adapter) {
      throw new Error(`LLM provider "${provider}" is not registered. Add a provider adapter before using model ${JSON.stringify(input.model ?? provider)}.`);
    }
    return adapter;
  }

  createAdapter(input: LlmAdapterCreateInput = {}): LlmAdapter {
    const provider = this.resolveProvider(input);
    return provider.createAdapter({
      ...input,
      provider: provider.provider,
      model: input.model ?? provider.defaultModel(input),
    });
  }

  inferProvider(model?: string): LlmProvider {
    return LlmProviderInference.infer({
      model,
      providers: this.providers,
      defaultProvider: this.defaultProvider,
    });
  }

  listProviders(): LlmProvider[] {
    return [...this.providersById.keys()];
  }
}
