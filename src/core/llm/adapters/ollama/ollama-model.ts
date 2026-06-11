/**
 * Ollama models are selected in Heddle with an `ollama/` or `ollama:` prefix,
 * while Ollama's OpenAI-compatible endpoint expects the local model name.
 */
export class OllamaModelName {
  static toProviderModel(model: string): string {
    return model.trim().replace(/^ollama[/:]/i, '');
  }

  static toHeddleModel(model: string): string {
    const providerModel = OllamaModelName.toProviderModel(model);
    if (!providerModel) {
      throw new Error('Ollama model name is required.');
    }
    return `ollama/${providerModel}`;
  }
}
