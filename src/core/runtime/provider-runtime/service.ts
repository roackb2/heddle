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
    const credentialRuntime = LlmProviderRuntimeService.credentialRuntime(input);
    const resolution = RuntimeCredentialService.resolveForModel(input.model, credentialRuntime);

    return {
      model: input.model,
      provider: resolution.provider,
      apiKey: resolution.apiKey,
      credential: resolution.credential,
      credentialSource: resolution.source,
      llmRuntime: {
        reasoningEffort: input.reasoningEffort,
        endpoint: RuntimeCredentialService.resolveOpenAiCompatibleEndpointRuntime(
          resolution.provider,
          credentialRuntime,
        ),
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
      credential: input.credential,
      credentialStorePath: input.credentialStorePath,
      preferApiKey: input.preferApiKey,
    };
  }
}
