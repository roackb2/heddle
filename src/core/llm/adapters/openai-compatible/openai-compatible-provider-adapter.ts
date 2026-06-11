import type { LlmAdapterCreateInput } from '@/core/llm/types.js';
import type { LlmProviderAdapter } from '@/core/llm/registry/index.js';
import { OpenAiCompatibleAdapter } from './openai-compatible-adapter.js';
import { OpenAiCompatibleModelName } from './openai-compatible-model.js';
import { OpenAiCompatibleProviderProfileService } from './openai-compatible-profiles.js';
import type { OpenAiCompatibleProviderProfile } from './types.js';

/**
 * Registers one OpenAI-compatible profile with the built-in LLM registry.
 * Each instance owns one provider prefix and delegates shared transport to
 * `OpenAiCompatibleAdapter`.
 */
export class OpenAiCompatibleProviderAdapter implements LlmProviderAdapter {
  readonly provider;

  constructor(private readonly profile: OpenAiCompatibleProviderProfile) {
    this.provider = profile.id;
  }

  inferModel(model: string): boolean {
    return OpenAiCompatibleProviderProfileService.findByModel(model)?.id === this.provider;
  }

  defaultModel(): string {
    const model = process.env[this.profile.defaultModelEnvName]?.trim();
    if (!model) {
      throw new Error(`${this.profile.label} model is required. Set ${this.profile.defaultModelEnvName} or select a model with the ${this.profile.modelPrefix}/<model> prefix.`);
    }
    return OpenAiCompatibleModelName.toHeddleModel(this.profile, model);
  }

  createAdapter(input: LlmAdapterCreateInput & { provider: OpenAiCompatibleProviderProfile['id']; model: string }): OpenAiCompatibleAdapter {
    return new OpenAiCompatibleAdapter({
      ...input,
      profile: this.profile,
    });
  }
}
