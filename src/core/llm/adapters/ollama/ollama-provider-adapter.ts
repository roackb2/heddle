import type { LlmAdapterCreateInput } from '@/core/llm/types.js';
import type { LlmProviderAdapter } from '@/core/llm/registry/index.js';
import { LlmProviderInference } from '@/core/llm/registry/provider-inference.js';
import { OllamaAdapter } from './ollama-adapter.js';
import { OllamaModelName } from './ollama-model.js';

/**
 * Registers Ollama as a first-class provider. The adapter requires an explicit
 * model selection or OLLAMA_MODEL, because installed local model names vary by
 * machine and should not be hardcoded in runtime policy.
 */
export class OllamaProviderAdapter implements LlmProviderAdapter {
  readonly provider = 'ollama' as const;

  inferModel(model: string): boolean {
    return LlmProviderInference.matchesProviderModel(this.provider, model.trim());
  }

  defaultModel(): string {
    const model = process.env.OLLAMA_MODEL?.trim();
    if (!model) {
      throw new Error('Ollama model is required. Set OLLAMA_MODEL or select a model with the ollama/<model> prefix.');
    }
    return OllamaModelName.toHeddleModel(model);
  }

  createAdapter(input: LlmAdapterCreateInput & { provider: 'ollama'; model: string }): OllamaAdapter {
    return new OllamaAdapter(input);
  }
}
