import type { Readable, Writable } from 'node:stream';
import type { ArtifactRepository } from '@/core/artifacts/index.js';
import type { ChatSessionRepository } from '@/core/chat/engine/sessions/repository/index.js';
import type { ChatArchiveRepository } from '@/core/chat/engine/sessions/archives/index.js';
import type { ToolDefinition } from '@/core/types.js';
import type { ConversationEngine } from '../types.js';
import type { ChatSession } from '../../types.js';
import type { ConversationTurnResultSummary } from '../turn-result.js';
import type { ConversationEngineHost, ConversationEngineHostExtension } from '../types.js';
import type { HeddlePersistenceCapabilities } from '../persistence/index.js';
import type {
  ConversationAgentCredentialContext,
  ConversationAgentCredentialPreflightOptions,
  ConversationAgentMemoryMaintenanceMode,
  ConversationAgentRuntimeDefaults,
  ConversationAgentRuntimeDefaultsInput,
} from '../conversation-agent/index.js';

export type QuickstartConversationCliMemoryMaintenanceMode = ConversationAgentMemoryMaintenanceMode;

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

export type QuickstartConversationCliCredentialContext = ConversationAgentCredentialContext;

export type QuickstartConversationCliCredentialPreflightOptions =
  ConversationAgentCredentialPreflightOptions & {
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
  reasoningEffort?: ConversationAgentRuntimeDefaultsInput['reasoningEffort'];
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

export type QuickstartConversationCliRunnerDefaultsInput = ConversationAgentRuntimeDefaultsInput;

export type QuickstartConversationCliRunnerDefaults = ConversationAgentRuntimeDefaults;
