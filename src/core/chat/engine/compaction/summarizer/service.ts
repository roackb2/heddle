import { createLlmAdapter, inferProviderFromModel } from '@/core/llm/factory.js';
import {
  hasProviderCredentialForModel,
  resolveApiKeyForModel,
  resolveProviderCredentialSourceForModel,
  type ApiKeyRuntime,
  type ProviderCredentialSource,
} from '@/core/runtime/api-keys.js';
import {
  credentialModeFromSource,
  resolveSystemSelectedModel,
  type ModelCredentialMode,
} from '@/core/llm/model-policy.js';
import { CompactionText } from '../text.js';
import type { ConversationCompactionOptions } from '../types.js';
import { ConversationArchiveSummarizerContextBuilder } from './context-builder.js';
import type {
  ConversationArchiveSummarizerRuntime,
  ConversationArchiveSummaryContext,
  ResolvedConversationArchiveSummarizer,
} from './types.js';

/**
 * Resolves and runs the LLM summarizer for archived conversation slices.
 */
export class ConversationArchiveSummarizer {
  static resolve(options: ConversationCompactionOptions): ResolvedConversationArchiveSummarizer {
    if (options.summarizer?.llm) {
      return {
        llm: options.summarizer.llm,
        model: options.summarizer.llm.info?.model ?? options.summarizer.model ?? options.runtime.model,
      };
    }

    const provider =
      options.summarizer?.provider === 'active' || !options.summarizer?.provider ?
        inferProviderFromModel(options.runtime.model)
      : options.summarizer.provider;
    const model =
      options.summarizer?.model
      ?? resolveSystemSelectedModel({
        purpose: 'chat-compaction',
        provider,
        activeModel: options.runtime.model,
        credentialMode: ConversationArchiveSummarizer.resolveCredentialMode({
          activeModel: options.runtime.model,
          explicitApiKey: options.summarizer?.apiKey,
          credentialSource: options.summarizer?.credentialSource,
        }),
      });
    const apiKey = options.summarizer?.apiKey ?? resolveApiKeyForModel(model);
    const summarizerCredentialRuntime: ApiKeyRuntime = {
      apiKey,
      apiKeyProvider: options.summarizer?.apiKey ? 'explicit' : apiKey ? provider : undefined,
    };
    if (!hasProviderCredentialForModel(model, summarizerCredentialRuntime)) {
      return { model };
    }

    return {
      model,
      llm: createLlmAdapter({ model, apiKey }),
    };
  }

  static async summarizeArchive(options: ConversationArchiveSummaryContext & {
    runtime: ConversationArchiveSummarizerRuntime;
  }): Promise<string> {
    const response = await options.runtime.llm.chat(
      ConversationArchiveSummarizerContextBuilder.build(options),
      [],
    );

    const content = response.content?.trim();
    if (!content) {
      throw new Error(`Compaction summarizer returned no content for ${options.runtime.model}`);
    }

    return content;
  }

  private static resolveCredentialMode(args: {
    activeModel: string;
    explicitApiKey?: string;
    credentialSource?: ProviderCredentialSource;
    credentialStorePath?: string;
  }): ModelCredentialMode {
    const { activeModel, explicitApiKey, credentialSource, credentialStorePath } = args;
    const credentialRuntime: ApiKeyRuntime = {
      apiKey: explicitApiKey,
      apiKeyProvider: explicitApiKey ? 'explicit' : undefined,
      credentialStorePath,
    };
    return credentialModeFromSource(credentialSource ?? resolveProviderCredentialSourceForModel(activeModel, credentialRuntime));
  }

  static deriveShortDescription(summary: string): string | undefined {
    const lines = summary
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'));
    const first = lines[0];
    return first ? CompactionText.truncateLine(first, 120) : undefined;
  }
}
