import type { LlmAdapter, LlmAdapterCreateInput, LlmProvider, LlmProviderResolutionInput } from '../types.js';

export type LlmProviderDefaultModelContext = LlmProviderResolutionInput;

export type LlmProviderAdapter = {
  provider: LlmProvider;
  inferModel(model: string): boolean;
  defaultModel(context?: LlmProviderDefaultModelContext): string;
  createAdapter(input: LlmAdapterCreateInput & { provider: LlmProvider; model: string }): LlmAdapter;
};

export type LlmProviderRegistryInput = {
  providers: readonly LlmProviderAdapter[];
  defaultProvider: LlmProvider;
};
