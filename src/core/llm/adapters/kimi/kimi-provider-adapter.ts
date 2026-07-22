import type { LlmAdapterCreateInput } from '@/core/llm/types.js';
import { OpenAiCompatibleModelName } from '@/core/llm/adapters/openai-compatible/openai-compatible-model.js';
import { OpenAiCompatibleProviderProfileService } from '@/core/llm/adapters/openai-compatible/openai-compatible-profiles.js';
import { LlmProviderInference } from '@/core/llm/registry/provider-inference.js';
import type { LlmProviderAdapter } from '@/core/llm/registry/types.js';
import { KimiAdapter } from './kimi-adapter.js';

const KIMI_PROFILE = OpenAiCompatibleProviderProfileService.get('kimi');

/** Registers the Kimi-specific preserved-thinking adapter with Heddle. */
export class KimiProviderAdapter implements LlmProviderAdapter {
  readonly provider = 'kimi' as const;

  inferModel(model: string): boolean {
    return LlmProviderInference.matchesProviderModel('kimi', model);
  }

  defaultModel(): string {
    return OpenAiCompatibleModelName.toHeddleModel(
      KIMI_PROFILE,
      process.env.KIMI_MODEL?.trim() || 'kimi-k3',
    );
  }

  createAdapter(input: LlmAdapterCreateInput & { provider: 'kimi'; model: string }): KimiAdapter {
    return new KimiAdapter({
      ...input,
      profile: KIMI_PROFILE,
    });
  }
}
