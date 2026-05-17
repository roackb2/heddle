import { DEFAULT_OPENAI_MODEL } from '@/core/config.js';
import type { LlmAdapterCreateInput } from '@/core/llm/types.js';
import type { LlmProviderAdapter } from '@/core/llm/registry/index.js';
import { LlmProviderInference } from '@/core/llm/registry/provider-inference.js';
import { OpenAiAdapter } from './openai-adapter.js';

/**
 * Registers OpenAI as an LLM provider adapter. Provider matching and adapter
 * construction stay here so the registry does not need OpenAI-specific logic.
 */
export class OpenAiProviderAdapter implements LlmProviderAdapter {
  readonly provider = 'openai' as const;

  inferModel(model: string): boolean {
    return LlmProviderInference.matchesProviderModel(this.provider, model.trim());
  }

  defaultModel(): string {
    return DEFAULT_OPENAI_MODEL;
  }

  createAdapter(input: LlmAdapterCreateInput & { provider: 'openai'; model: string }): OpenAiAdapter {
    return new OpenAiAdapter(input);
  }
}
