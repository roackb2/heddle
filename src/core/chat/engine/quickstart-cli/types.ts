import type { Readable, Writable } from 'node:stream';
import type { ArtifactRepository } from '@/core/artifacts/index.js';
import type { ReasoningEffort } from '@/core/llm/types.js';
import type { LlmProvider } from '@/core/llm/types.js';
import type { ProviderCredentialSource } from '@/core/runtime/credentials/index.js';
import type { ToolDefinition } from '@/core/types.js';
import type { ConversationEngine } from '../types.js';
import type { ChatSession } from '../../types.js';
import type { ConversationTurnResultSummary } from '../turn-result.js';
import type { ConversationEngineHost, ConversationEngineHostExtension } from '../types.js';

export type QuickstartConversationCliMemoryMaintenanceMode = 'none' | 'background' | 'inline';

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

export type QuickstartConversationCliCredentialContext = {
  model: string;
  preferApiKey?: boolean;
  provider: LlmProvider;
  source: ProviderCredentialSource;
};

export type QuickstartConversationCliCredentialPreflightOptions = {
  enabled?: boolean;
  missingCredentialHint?: string | ((context: QuickstartConversationCliCredentialContext) => string | undefined);
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
  reasoningEffort?: ReasoningEffort | string;
  apiKey?: string;
  preferApiKey?: boolean;
  credentialStorePath?: string;
  credentialPreflight?: boolean | QuickstartConversationCliCredentialPreflightOptions;
  systemContext?: string;
  memoryMaintenanceMode?: QuickstartConversationCliMemoryMaintenanceMode;
  tools?: ToolDefinition[];
  hostExtensions?: ConversationEngineHostExtension[];
  artifactRepository?: ArtifactRepository;
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

export type QuickstartConversationCliRunnerDefaultsInput = Pick<
  QuickstartConversationCliRunnerOptions,
  'maxSteps' | 'memoryMaintenanceMode' | 'model' | 'reasoningEffort' | 'stateRoot' | 'workspaceRoot'
> & {
  env?: Pick<
    NodeJS.ProcessEnv,
    'ANTHROPIC_MODEL' | 'HEDDLE_EXAMPLE_MODEL' | 'HEDDLE_MODEL' | 'OPENAI_MODEL'
  >;
};

export type QuickstartConversationCliRunnerDefaults = {
  maxSteps?: number;
  memoryMaintenanceMode: QuickstartConversationCliMemoryMaintenanceMode;
  model: string;
  reasoningEffort?: ReasoningEffort;
  stateRoot: string;
  workspaceRoot: string;
};
