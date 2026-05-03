import { join } from 'node:path';
import { DEFAULT_OPENAI_MODEL } from '../../../config.js';
import { createLlmAdapter } from '../../../llm/factory.js';
import { inferProviderFromModel } from '../../../llm/providers.js';
import type { LlmAdapter, LlmProvider } from '../../../llm/types.js';
import {
  formatMissingProviderCredentialMessage,
  hasProviderCredentialForModel,
  resolveApiKeyForModel,
  resolveProviderCredentialSourceForModel,
  type ProviderCredentialSource,
} from '../../../runtime/api-keys.js';
import { appendMemoryCatalogSystemContext } from '../../../memory/catalog.js';

export type ChatTurnRuntime = {
  model: string;
  provider: LlmProvider;
  apiKey: string | undefined;
  providerCredentialSource: ProviderCredentialSource;
  memoryDir: string;
  systemContext: string | undefined;
  llm: LlmAdapter;
};

export type ResolveConversationTurnRuntimeArgs = {
  stateRoot: string;
  sessionModel?: string;
  apiKey?: string;
  preferApiKey?: boolean;
  credentialStorePath?: string;
  systemContext?: string;
  env?: Pick<NodeJS.ProcessEnv, 'OPENAI_MODEL' | 'ANTHROPIC_MODEL'>;
};

export function resolveConversationTurnModel(args: {
  sessionModel?: string;
  env?: Pick<NodeJS.ProcessEnv, 'OPENAI_MODEL' | 'ANTHROPIC_MODEL'>;
}): string {
  const env = args.env ?? process.env;
  return args.sessionModel ?? env.OPENAI_MODEL ?? env.ANTHROPIC_MODEL ?? DEFAULT_OPENAI_MODEL;
}

export function resolveConversationTurnRuntime(args: ResolveConversationTurnRuntimeArgs): ChatTurnRuntime {
  const model = resolveConversationTurnModel({
    sessionModel: args.sessionModel,
    env: args.env,
  });
  const provider = inferProviderFromModel(model);
  const apiKey = args.apiKey ?? resolveApiKeyForModel(model, { preferApiKey: args.preferApiKey });
  const providerCredentialSource = resolveProviderCredentialSourceForModel(model, {
    apiKey,
    apiKeyProvider: args.apiKey ? 'explicit' : apiKey ? provider : undefined,
    credentialStorePath: args.credentialStorePath,
    preferApiKey: args.preferApiKey,
  });

  assertConversationTurnCredential({
    model,
    apiKey: args.apiKey,
    credentialStorePath: args.credentialStorePath,
    preferApiKey: args.preferApiKey,
  });

  const memoryDir = join(args.stateRoot, 'memory');
  return {
    model,
    provider,
    apiKey,
    providerCredentialSource,
    memoryDir,
    systemContext: appendMemoryCatalogSystemContext({
      systemContext: args.systemContext,
      memoryRoot: memoryDir,
    }),
    llm: createLlmAdapter({ model, apiKey, credentialStorePath: args.credentialStorePath }),
  };
}

function assertConversationTurnCredential(args: {
  model: string;
  apiKey?: string;
  credentialStorePath?: string;
  preferApiKey?: boolean;
}) {
  const hasCredential = hasProviderCredentialForModel(args.model, {
    apiKey: args.apiKey,
    apiKeyProvider: args.apiKey ? 'explicit' : undefined,
    credentialStorePath: args.credentialStorePath,
    preferApiKey: args.preferApiKey,
  });

  if (!hasCredential) {
    throw new Error(formatMissingProviderCredentialMessage(args.model));
  }
}
