import type { OpenAiCompatibleProviderProfile } from './types.js';
import { OpenAiCompatibleProviderProfileService } from './openai-compatible-profiles.js';

/**
 * Converts between Heddle's provider-prefixed model IDs and provider-local
 * model IDs. Keep this at the OpenAI-compatible profile boundary so adapters,
 * discovery, and pickers share the same naming rules.
 */
export class OpenAiCompatibleModelName {
  static toProviderModel(profile: OpenAiCompatibleProviderProfile, model: string): string {
    const trimmed = model.trim();
    const matchingPrefix = OpenAiCompatibleProviderProfileService.prefixes(profile)
      .find((prefix) => trimmed.toLowerCase().startsWith(`${prefix}/`) || trimmed.toLowerCase().startsWith(`${prefix}:`));
    if (!matchingPrefix) {
      return trimmed;
    }

    return trimmed.slice(matchingPrefix.length + 1);
  }

  static toHeddleModel(profile: OpenAiCompatibleProviderProfile, model: string): string {
    const providerModel = OpenAiCompatibleModelName.toProviderModel(profile, model);
    if (!providerModel) {
      throw new Error(`${profile.label} model name is required.`);
    }
    return `${profile.modelPrefix}/${providerModel}`;
  }
}
