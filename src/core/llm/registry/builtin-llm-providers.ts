import { DEFAULT_LLM_PROVIDER } from '@/core/config.js';
import { AnthropicProviderAdapter } from '../adapters/anthropic/index.js';
import { KimiProviderAdapter } from '../adapters/kimi/index.js';
import {
  OpenAiCompatibleProviderAdapter,
  OpenAiCompatibleProviderProfileService,
} from '../adapters/openai-compatible/index.js';
import { OpenAiProviderAdapter } from '../adapters/openai/index.js';
import { LlmProviderRegistry } from './llm-provider-registry.js';

export class BuiltinLlmProviderRegistry {
  static create(): LlmProviderRegistry {
    return new LlmProviderRegistry({
      defaultProvider: DEFAULT_LLM_PROVIDER,
      providers: [
        new OpenAiProviderAdapter(),
        new AnthropicProviderAdapter(),
        new KimiProviderAdapter(),
        ...OpenAiCompatibleProviderProfileService.list()
          .filter((profile) => profile.id !== 'kimi')
          .map((profile) => new OpenAiCompatibleProviderAdapter(profile)),
      ],
    });
  }
}
