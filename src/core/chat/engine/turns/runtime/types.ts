import type { LlmAdapter, LlmProvider, ReasoningEffort } from '@/core/llm/types.js';
import type { ApiKeyRuntime, ProviderCredentialSource } from '@/core/runtime/credentials/index.js';
import type { ChatSession } from '@/core/chat/types.js';
import type { ConversationCompactionOptions } from '@/core/chat/engine/compaction/index.js';

export type ChatTurnRuntime = {
  model: string;
  reasoningEffort?: ReasoningEffort;
  provider: LlmProvider;
  apiKey: string | undefined;
  providerCredentialSource: ProviderCredentialSource;
  summarizer: ConversationCompactionOptions['summarizer'];
  memoryDir: string;
  systemContext: string | undefined;
  llm: LlmAdapter;
};

export type ConversationTurnRuntimeConfig = ApiKeyRuntime & {
  stateRoot: string;
  systemContext?: string;
  artifactsEnabled?: boolean;
  env?: Pick<NodeJS.ProcessEnv, 'OPENAI_MODEL' | 'ANTHROPIC_MODEL'>;
};

export type ConversationTurnRuntimeSession = Pick<ChatSession, 'model' | 'reasoningEffort'>;

export type ResolveConversationTurnRuntimeArgs = {
  config: ConversationTurnRuntimeConfig;
  session: ConversationTurnRuntimeSession;
};
