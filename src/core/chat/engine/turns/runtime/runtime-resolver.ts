import { join } from 'node:path';
import { DEFAULT_OPENAI_MODEL } from '@/core/config.js';
import { createLlmAdapter } from '@/core/llm/factory.js';
import { inferProviderFromModel } from '@/core/llm/providers.js';
import {
  formatMissingProviderCredentialMessage,
  hasProviderCredentialForModel,
  resolveApiKeyForModel,
  resolveProviderCredentialSourceForModel,
} from '@/core/runtime/api-keys.js';
import { appendAwarenessDomainSystemContext } from '@/core/awareness/domain-prompt.js';
import { appendMemoryCatalogSystemContext } from '@/core/memory/catalog.js';
import type { ApiKeyRuntime } from '@/core/runtime/api-keys.js';
import type { ChatTurnRuntime, ResolveConversationTurnRuntimeArgs } from './types.js';

/**
 * Resolves the model/provider/runtime adapter for a persisted conversation turn.
 */
export class ConversationTurnRuntimeResolver {
  static resolveModel(args: {
    sessionModel?: string;
    env?: Pick<NodeJS.ProcessEnv, 'OPENAI_MODEL' | 'ANTHROPIC_MODEL'>;
  }): string {
    const env = args.env ?? process.env;
    return args.sessionModel ?? env.OPENAI_MODEL ?? env.ANTHROPIC_MODEL ?? DEFAULT_OPENAI_MODEL;
  }

  static resolve(args: ResolveConversationTurnRuntimeArgs): ChatTurnRuntime {
    const { config, session } = args;
    const model = ConversationTurnRuntimeResolver.resolveModel({
      sessionModel: session.model,
      env: config.env,
    });
    const provider = inferProviderFromModel(model);
    const credentialRuntime = ConversationTurnRuntimeResolver.credentialRuntime(config);
    const apiKey = config.apiKey ?? resolveApiKeyForModel(model, credentialRuntime);
    const providerCredentialSource = resolveProviderCredentialSourceForModel(model, {
      ...credentialRuntime,
      apiKey,
      apiKeyProvider: config.apiKey ? 'explicit' : apiKey ? provider : undefined,
    });

    ConversationTurnRuntimeResolver.assertCredential({
      model,
      credentialRuntime,
    });

    const memoryDir = join(config.stateRoot, 'memory');
    return {
      model,
      provider,
      apiKey,
      providerCredentialSource,
      memoryDir,
      systemContext: appendAwarenessDomainSystemContext(appendMemoryCatalogSystemContext({
        systemContext: config.systemContext,
        memoryRoot: memoryDir,
      })),
      reasoningEffort: session.reasoningEffort,
      llm: createLlmAdapter({
        model,
        apiKey,
        credentialStorePath: config.credentialStorePath,
        reasoningEffort: session.reasoningEffort,
      }),
    };
  }

  private static credentialRuntime(config: ApiKeyRuntime): ApiKeyRuntime {
    return {
      apiKey: config.apiKey,
      apiKeyProvider: config.apiKey ? 'explicit' : undefined,
      credentialStorePath: config.credentialStorePath,
      preferApiKey: config.preferApiKey,
    };
  }

  private static assertCredential(args: { model: string; credentialRuntime: ApiKeyRuntime }) {
    const hasCredential = hasProviderCredentialForModel(args.model, args.credentialRuntime);

    if (!hasCredential) {
      throw new Error(formatMissingProviderCredentialMessage(args.model));
    }
  }
}
