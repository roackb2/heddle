import { join } from 'node:path';
import { DEFAULT_OPENAI_MODEL } from '@/core/config.js';
import { LlmAdapterService } from '@/core/llm/index.js';
import { LlmProviderRuntimeService } from '@/core/runtime/provider-runtime/index.js';
import { appendArtifactDomainSystemContext } from '@/core/artifacts/domain-prompt.js';
import { appendAwarenessDomainSystemContext } from '@/core/awareness/domain-prompt.js';
import { MemoryCatalogService } from '@/core/memory/catalog.js';
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
    const credentialRuntime = ConversationTurnRuntimeResolver.credentialRuntime(config);
    const providerRuntime = LlmProviderRuntimeService.resolve({
      ...credentialRuntime,
      model,
      reasoningEffort: session.reasoningEffort,
    });
    LlmProviderRuntimeService.assertRunnable(providerRuntime);

    const apiKey = config.apiKey ?? providerRuntime.apiKey;
    const memoryDir = join(config.stateRoot, 'memory');
    const memorySystemContext = new MemoryCatalogService(memoryDir).appendCatalogSystemContext({
      systemContext: config.systemContext,
    });
    const domainSystemContext = config.artifactsEnabled === false
      ? memorySystemContext
      : appendArtifactDomainSystemContext(memorySystemContext);

    return {
      model,
      provider: providerRuntime.provider,
      apiKey,
      providerCredentialSource: providerRuntime.credentialSource,
      summarizer: {
        apiKey,
        credentialStorePath: config.credentialStorePath,
        credentialSource: providerRuntime.credentialSource,
      },
      memoryDir,
      systemContext: appendAwarenessDomainSystemContext(domainSystemContext),
      reasoningEffort: session.reasoningEffort,
      llm: LlmAdapterService.create({
        model,
        credentials: {
          apiKey,
          credentialStorePath: config.credentialStorePath,
        },
        runtime: {
          ...providerRuntime.llmRuntime,
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
}
