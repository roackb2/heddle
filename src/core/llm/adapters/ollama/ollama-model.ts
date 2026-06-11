import { OpenAiCompatibleModelName } from '../openai-compatible/openai-compatible-model.js';
import { OpenAiCompatibleProviderProfileService } from '../openai-compatible/openai-compatible-profiles.js';

const OLLAMA_PROFILE = OpenAiCompatibleProviderProfileService.get('ollama');

/**
 * Backwards-compatible Ollama model-name facade. The implementation lives in
 * the OpenAI-compatible profile boundary so every compatible provider follows
 * the same prefix rules.
 */
export class OllamaModelName {
  static toProviderModel(model: string): string {
    return OpenAiCompatibleModelName.toProviderModel(OLLAMA_PROFILE, model);
  }

  static toHeddleModel(model: string): string {
    return OpenAiCompatibleModelName.toHeddleModel(OLLAMA_PROFILE, model);
  }
}
