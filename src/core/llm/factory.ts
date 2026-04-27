// ---------------------------------------------------------------------------
// LLM Adapter Factory
// Provider-neutral adapter selection and capability metadata.
// ---------------------------------------------------------------------------

import { DEFAULT_ANTHROPIC_MODEL, DEFAULT_LLM_PROVIDER, DEFAULT_OPENAI_MODEL } from '../config.js';
import { createAnthropicAdapter } from './anthropic.js';
import { createOpenAiAdapter } from './openai.js';
import type { LlmAdapter, LlmProvider } from './types.js';
import { inferProviderFromModel } from './providers.js';
import type { StoredProviderCredential } from '../auth/provider-credentials.js';
import { resolveOAuthCredentialForModel } from '../runtime/api-keys.js';

export type CreateLlmAdapterOptions = {
  provider?: LlmProvider;
  model?: string;
  apiKey?: string;
  credential?: StoredProviderCredential;
  credentialStorePath?: string;
};

export function createLlmAdapter(options: CreateLlmAdapterOptions = {}): LlmAdapter {
  const provider = resolveLlmProvider(options);
  const model =
    options.model
    ?? (provider === 'anthropic' ? DEFAULT_ANTHROPIC_MODEL : DEFAULT_OPENAI_MODEL);
  const credential =
    options.credential
    ?? (!options.apiKey && provider === 'openai' ? resolveOAuthCredentialForModel(model, {
      storePath: options.credentialStorePath,
    }) : undefined);

  switch (provider) {
    case 'openai':
      return createOpenAiAdapter({
        apiKey: options.apiKey,
        model,
        credential,
        credentialStorePath: options.credentialStorePath,
      });
    case 'anthropic':
      return createAnthropicAdapter({
        apiKey: options.apiKey,
        model,
      });
    case 'google':
      throw new Error(
        `Model provider "google" is not wired yet. Add a Gemini adapter before using model ${JSON.stringify(options.model ?? 'gemini')}.`,
      );
  }
}

export function resolveLlmProvider(options: CreateLlmAdapterOptions = {}): LlmProvider {
  if (options.provider) {
    return options.provider;
  }

  if (options.model) {
    return inferProviderFromModel(options.model);
  }

  return DEFAULT_LLM_PROVIDER;
}

export { inferProviderFromModel } from './providers.js';
