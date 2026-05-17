import { join } from 'node:path';
import { DEFAULT_OPENAI_MODEL } from '@/core/config.js';
import { LlmAdapterService } from '@/core/llm/index.js';
import {
  RuntimeCredentialService,
} from '@/core/runtime/credentials/index.js';
import { appendAwarenessDomainSystemContext } from '@/core/awareness/domain-prompt.js';
import { appendMemoryCatalogSystemContext } from '@/core/memory/catalog.js';
import type { ApiKeyRuntime } from '@/core/runtime/credentials/index.js';
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
    const provider = LlmAdapterService.inferProvider(model);
    const credentialRuntime = ConversationTurnRuntimeResolver.credentialRuntime(config);
    const apiKey = config.apiKey ?? RuntimeCredentialService.resolveApiKeyForModel(model, credentialRuntime);
    const providerCredentialSource = RuntimeCredentialService.resolveCredentialSourceForModel(model, {
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
      llm: LlmAdapterService.create({
        model,
        credentials: {
          apiKey,
          credentialStorePath: config.credentialStorePath,
        },
        runtime: {
          reasoningEffort: session.reasoningEffort,
        },
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
    const hasCredential = RuntimeCredentialService.hasCredentialForModel(args.model, args.credentialRuntime);

    if (!hasCredential) {
      throw new Error(RuntimeCredentialService.formatMissingCredentialMessage(args.model));
    }
  }
}
