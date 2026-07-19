import type { ConversationActivity } from '@/core/live/index.js';
import type {
  ConversationEngineConfig,
  ConversationEngineHost,
  EnsureConversationSessionInput,
  SubmitConversationTurnInput,
} from '@/core/chat/engine/types.js';
import type { ConversationTurnResultSummary } from '@/core/chat/engine/turn-result.js';
import type {
  ConversationSdkCredentialContext,
  ConversationSdkCredentialPreflightOptions,
  ConversationSdkMemoryMaintenanceMode,
  ConversationSdkRuntimeDefaults,
  ConversationSdkRuntimeDefaultsInput,
} from '../runtime/index.js';

export type ConversationAgentMemoryMaintenanceMode = ConversationSdkMemoryMaintenanceMode;
export type ConversationAgentCredentialContext = ConversationSdkCredentialContext;
export type ConversationAgentCredentialPreflightOptions = ConversationSdkCredentialPreflightOptions;
export type ConversationAgentRuntimeDefaultsInput = ConversationSdkRuntimeDefaultsInput;
export type ConversationAgentRuntimeDefaults = ConversationSdkRuntimeDefaults;

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
