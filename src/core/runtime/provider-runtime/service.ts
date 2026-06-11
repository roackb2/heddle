import { LlmAdapterService } from '@/core/llm/index.js';
import {
  RuntimeCredentialService,
} from '../credentials/index.js';
import type { ApiKeyRuntime } from '../credentials/index.js';
import type { LlmProviderRuntimeInput, LlmProviderRuntimeResolution } from './types.js';

/**
 * Resolves provider-specific execution facts once at the runtime boundary.
 * Callers should pass the returned `llmRuntime` into `LlmAdapterService.create`
 * instead of reconstructing endpoint or credential policy at call sites.
 */
export class LlmProviderRuntimeService {
  static resolve(input: LlmProviderRuntimeInput): LlmProviderRuntimeResolution {
    const provider = LlmAdapterService.inferProvider(input.model);
    const credentialRuntime = LlmProviderRuntimeService.credentialRuntime(input);
    const apiKey = RuntimeCredentialService.resolveApiKeyForModel(input.model, credentialRuntime);
    const credentialSource = RuntimeCredentialService.resolveCredentialSourceForModel(input.model, {
      ...credentialRuntime,
      apiKey,
      apiKeyProvider: input.apiKey ? 'explicit' : apiKey ? provider : undefined,
    });

    return {
      model: input.model,
      provider,
      apiKey,
      credentialSource,
      llmRuntime: {
        reasoningEffort: input.reasoningEffort,
        endpoint: credentialSource.type === 'local-endpoint' ? {
          baseUrl: credentialSource.baseUrl,
          auth: { type: 'none' },
        } : undefined,
      },
    };
  }

  static assertRunnable(resolution: Pick<LlmProviderRuntimeResolution, 'model' | 'credentialSource'>): void {
    if (resolution.credentialSource.type === 'missing') {
      throw new Error(RuntimeCredentialService.formatMissingCredentialMessage(resolution.model));
    }
  }

  private static credentialRuntime(input: LlmProviderRuntimeInput): ApiKeyRuntime {
    return {
      apiKey: input.apiKey,
      apiKeyProvider: input.apiKey ? 'explicit' : undefined,
      credentialStorePath: input.credentialStorePath,
      preferApiKey: input.preferApiKey,
    };
  }
}
