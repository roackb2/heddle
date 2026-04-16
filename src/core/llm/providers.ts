import { DEFAULT_LLM_PROVIDER } from '../config.js';
import type { LlmProvider } from './types.js';

export function inferProviderFromModel(model: string): LlmProvider {
  const normalized = model.trim().toLowerCase();

  if (!normalized) {
    return DEFAULT_LLM_PROVIDER;
  }

  if (
    normalized.startsWith('gpt-') ||
    normalized.startsWith('o1') ||
    normalized.startsWith('o3') ||
    normalized.startsWith('o4')
  ) {
    return 'openai';
  }

  if (normalized.startsWith('claude')) {
    return 'anthropic';
  }

  if (normalized.startsWith('gemini')) {
    return 'google';
  }

  return DEFAULT_LLM_PROVIDER;
}
