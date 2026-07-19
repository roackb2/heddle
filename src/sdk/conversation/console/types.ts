import type { Readable, Writable } from 'node:stream';
import type { ArtifactRepository } from '@/core/artifacts/index.js';
import type { HeddlePersistenceCapabilities } from '@/core/chat/engine/persistence/index.js';
import type { ChatArchiveRepository } from '@/core/chat/engine/sessions/archives/index.js';
import type { ChatSessionRepository } from '@/core/chat/engine/sessions/repository/index.js';
import type { ConversationTurnResultSummary } from '@/core/chat/engine/turn-result.js';
import type {
  ConversationEngine,
  ConversationEngineHost,
  ConversationEngineHostExtension,
} from '@/core/chat/engine/types.js';
import type { ChatSession } from '@/core/chat/types.js';
import type { ToolDefinition } from '@/core/types.js';
import type {
  ConversationSdkCredentialContext,
  ConversationSdkCredentialPreflightOptions,
  ConversationSdkMemoryMaintenanceMode,
  ConversationSdkRuntimeDefaults,
  ConversationSdkRuntimeDefaultsInput,
} from '../runtime/index.js';

export type QuickstartConversationCliMemoryMaintenanceMode = ConversationSdkMemoryMaintenanceMode;

export type QuickstartConversationCliLocalCommandContext = {
  command: string;
  engine: ConversationEngine;
  output: Writable;
  session: ChatSession;
  stateRoot: string;
  workspaceRoot: string;
};

export type QuickstartConversationCliLocalCommand = {
  command: string;
  aliases?: string[];
  description: string;
  run(context: QuickstartConversationCliLocalCommandContext): void | Promise<void>;
};

export type QuickstartConversationCliTurnContext = {
  engine: ConversationEngine;
  prompt: string;
  session: ChatSession;
  stateRoot: string;
  submittedPrompt: string;
  workspaceRoot: string;
};

export type QuickstartConversationCliCredentialContext = ConversationSdkCredentialContext;

export type QuickstartConversationCliCredentialPreflightOptions =
  ConversationSdkCredentialPreflightOptions & {
    status?: 'off' | 'status';
  };

export type QuickstartConversationCliRunnerOptions = {
  model?: string;
  workspaceRoot?: string;
  stateRoot?: string;
  sessionId?: string;
  sessionName?: string;
  promptLabel?: string;
  oncePrompt?: string;
  prompts?: string[];
  maxSteps?: number;
  reasoningEffort?: ConversationSdkRuntimeDefaultsInput['reasoningEffort'];
  apiKey?: string;
  preferApiKey?: boolean;
  credentialStorePath?: string;
  credentialPreflight?: boolean | QuickstartConversationCliCredentialPreflightOptions;
  systemContext?: string;
  memoryMaintenanceMode?: QuickstartConversationCliMemoryMaintenanceMode;
  tools?: ToolDefinition[];
  hostExtensions?: ConversationEngineHostExtension[];
  artifactRepository?: ArtifactRepository;
  persistence?: HeddlePersistenceCapabilities;
  /** @deprecated Use `persistence.conversations.sessions`. */
  sessionRepository?: ChatSessionRepository;
  /** @deprecated Use `persistence.conversations.archives`. */
  archiveRepository?: ChatArchiveRepository;
  host?: ConversationEngineHost;
  localCommands?: QuickstartConversationCliLocalCommand[];
  formatPrompt?: (prompt: string) => string;
  onTurnStarted?: (context: QuickstartConversationCliTurnContext) => void | Promise<void>;
  onTurnFinished?: (context: QuickstartConversationCliTurnContext & {
    result: ConversationTurnResultSummary;
  }) => void | Promise<void>;
  input?: Readable;
  output?: Writable;
};

export type QuickstartConversationCliRunnerDefaultsInput = ConversationSdkRuntimeDefaultsInput;

export type QuickstartConversationCliRunnerDefaults = ConversationSdkRuntimeDefaults;
