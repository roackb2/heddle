import type { LlmAdapter, LlmProvider, ReasoningEffort } from '@/core/llm/types.js';
import type { ApiKeyRuntime, ProviderCredentialSource } from '@/core/runtime/api-keys.js';
import type { ChatSession } from '@/core/chat/types.js';

export type ChatTurnRuntime = {
  model: string;
  reasoningEffort?: ReasoningEffort;
  provider: LlmProvider;
  apiKey: string | undefined;
  providerCredentialSource: ProviderCredentialSource;
  memoryDir: string;
  systemContext: string | undefined;
  llm: LlmAdapter;
};

export type ConversationTurnRuntimeConfig = ApiKeyRuntime & {
  stateRoot: string;
  systemContext?: string;
  env?: Pick<NodeJS.ProcessEnv, 'OPENAI_MODEL' | 'ANTHROPIC_MODEL'>;
};

export type ConversationTurnRuntimeSession = Pick<ChatSession, 'model' | 'reasoningEffort'>;

export type ResolveConversationTurnRuntimeArgs = {
  config: ConversationTurnRuntimeConfig;
  session: ConversationTurnRuntimeSession;
};
