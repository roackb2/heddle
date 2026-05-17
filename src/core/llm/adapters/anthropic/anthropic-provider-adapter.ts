import { DEFAULT_ANTHROPIC_MODEL } from '@/core/config.js';
import type { LlmAdapterCreateInput } from '@/core/llm/types.js';
import type { LlmProviderAdapter } from '@/core/llm/registry/index.js';
import { LlmProviderInference } from '@/core/llm/registry/provider-inference.js';
import { AnthropicAdapter } from './anthropic-adapter.js';

/**
 * Registers Anthropic as an LLM provider adapter. Claude-specific model
 * matching and API-key handling stay behind this provider boundary.
 */
export class AnthropicProviderAdapter implements LlmProviderAdapter {
  readonly provider = 'anthropic' as const;

  inferModel(model: string): boolean {
    return LlmProviderInference.matchesProviderModel(this.provider, model.trim());
  }

  defaultModel(): string {
    return DEFAULT_ANTHROPIC_MODEL;
  }

  createAdapter(input: LlmAdapterCreateInput & { provider: 'anthropic'; model: string }): AnthropicAdapter {
    return new AnthropicAdapter(input);
  }
}
