import type { ConversationEngineConfig } from '@/core/chat/engine/types.js';
import type { LlmProvider, ReasoningEffort } from '@/core/llm/types.js';
import type { ProviderCredentialSource } from '@/core/runtime/credentials/index.js';

export type ConversationSdkMemoryMaintenanceMode =
  NonNullable<ConversationEngineConfig['memoryMaintenanceMode']>;

export type ConversationSdkCredentialContext = {
  model: string;
  preferApiKey?: boolean;
  provider: LlmProvider;
  source: ProviderCredentialSource;
};

export type ConversationSdkCredentialPreflightOptions = {
  enabled?: boolean;
  missingCredentialHint?: string | ((context: ConversationSdkCredentialContext) => string | undefined);
};

export type ConversationSdkRuntimeDefaultsInput = {
  model?: string;
  workspaceRoot?: string;
  stateRoot?: string;
  maxSteps?: number;
  maxToolConcurrency?: number;
  reasoningEffort?: ReasoningEffort | string;
  memoryMaintenanceMode?: ConversationSdkMemoryMaintenanceMode;
  env?: Pick<
    NodeJS.ProcessEnv,
    'ANTHROPIC_MODEL' | 'HEDDLE_EXAMPLE_MODEL' | 'HEDDLE_MODEL' | 'OPENAI_MODEL'
  >;
};

export type ConversationSdkRuntimeDefaults = {
  model: string;
  workspaceRoot: string;
  stateRoot: string;
  maxSteps?: number;
  maxToolConcurrency?: number;
  reasoningEffort?: ReasoningEffort;
  memoryMaintenanceMode: ConversationSdkMemoryMaintenanceMode;
};
