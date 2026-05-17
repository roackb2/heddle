import { DEFAULT_LLM_PROVIDER } from '@/core/config.js';
import type { LlmProvider } from '../types.js';
import type { LlmProviderAdapter } from './types.js';

/**
 * Infers a provider from model naming conventions. Provider adapters own their
 * own model matching, while this class coordinates the registry-wide lookup.
 */
export class LlmProviderInference {
  static infer(args: {
    model?: string;
    providers: readonly LlmProviderAdapter[];
    defaultProvider: LlmProvider;
  }): LlmProvider {
    const normalized = args.model?.trim();
    if (!normalized) {
      return args.defaultProvider;
    }

    return args.providers.find((provider) => provider.inferModel(normalized))?.provider
      ?? LlmProviderInference.inferKnownProvider(normalized)
      ?? args.defaultProvider;
  }

  static inferBuiltin(model?: string, defaultProvider: LlmProvider = DEFAULT_LLM_PROVIDER): LlmProvider {
    const normalized = model?.trim();
    if (!normalized) {
      return defaultProvider;
    }

    return LlmProviderInference.inferKnownProvider(normalized) ?? defaultProvider;
  }

  static matchesProviderModel(provider: LlmProvider, model: string): boolean {
    return LlmProviderInference.matchers.some(([candidate, matches]) => candidate === provider && matches(model.toLowerCase()));
  }

  private static inferKnownProvider(model: string): LlmProvider | undefined {
    const normalized = model.toLowerCase();
    return LlmProviderInference.matchers.find(([, matches]) => matches(normalized))?.[0];
  }

  private static readonly matchers: Array<[LlmProvider, (value: string) => boolean]> = [
    ['openai', (value) =>
      value.startsWith('gpt-')
      || value.startsWith('o1')
      || value.startsWith('o3')
      || value.startsWith('o4')],
    ['anthropic', (value) => value.startsWith('claude')],
    ['google', (value) => value.startsWith('gemini')],
    ['ollama', (value) => value.startsWith('ollama/') || value.startsWith('ollama:')],
    ['huggingface', (value) => value.startsWith('hf/') || value.startsWith('huggingface/')],
  ];
}
