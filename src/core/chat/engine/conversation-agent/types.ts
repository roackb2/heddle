import type { ConversationActivity } from '@/core/live/index.js';
import type { LlmProvider, ReasoningEffort } from '@/core/llm/types.js';
import type { ProviderCredentialSource } from '@/core/runtime/credentials/index.js';
import type {
  ConversationEngineConfig,
  ConversationEngineHost,
  EnsureConversationSessionInput,
  SubmitConversationTurnInput,
} from '../types.js';
import type { ConversationTurnResultSummary } from '../turn-result.js';

export type ConversationAgentMemoryMaintenanceMode =
  NonNullable<ConversationEngineConfig['memoryMaintenanceMode']>;

export type ConversationAgentCredentialContext = {
  model: string;
  preferApiKey?: boolean;
  provider: LlmProvider;
  source: ProviderCredentialSource;
};

export type ConversationAgentCredentialPreflightOptions = {
  enabled?: boolean;
  missingCredentialHint?: string | ((context: ConversationAgentCredentialContext) => string | undefined);
};

export type ConversationAgentRuntimeDefaultsInput = {
  model?: string;
  workspaceRoot?: string;
  stateRoot?: string;
  maxSteps?: number;
  reasoningEffort?: ReasoningEffort | string;
  memoryMaintenanceMode?: ConversationAgentMemoryMaintenanceMode;
  env?: Pick<
    NodeJS.ProcessEnv,
    'ANTHROPIC_MODEL' | 'HEDDLE_EXAMPLE_MODEL' | 'HEDDLE_MODEL' | 'OPENAI_MODEL'
  >;
};

export type ConversationAgentRuntimeDefaults = {
  model: string;
  workspaceRoot: string;
  stateRoot: string;
  maxSteps?: number;
  reasoningEffort?: ReasoningEffort;
  memoryMaintenanceMode: ConversationAgentMemoryMaintenanceMode;
};

export type ConversationAgentSessionOptions = Omit<EnsureConversationSessionInput, 'id'> & {
  /** Stable durable identity. Defaults to `session-1`. */
  id?: string;
};

export type ConversationAgentOptions = Omit<
  ConversationEngineConfig,
  'memoryMaintenanceMode' | 'model' | 'reasoningEffort' | 'stateRoot' | 'workspaceRoot'
> & ConversationAgentRuntimeDefaultsInput & {
  credentialPreflight?: boolean | ConversationAgentCredentialPreflightOptions;
  host?: ConversationEngineHost;
  session?: ConversationAgentSessionOptions;
};

export type ConversationAgentRuntimeContext = ConversationAgentRuntimeDefaults & {
  credential?: ConversationAgentCredentialContext;
};

export type ConversationAgentSendInput = Omit<
  SubmitConversationTurnInput,
  'prompt' | 'sessionId'
> & {
  prompt: string;
};

export type ConversationAgentTurnResult = ConversationTurnResultSummary & {
  activities: ConversationActivity[];
  sessionCreated: boolean;
};
