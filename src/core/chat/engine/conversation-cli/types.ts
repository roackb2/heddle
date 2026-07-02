import type { Readable, Writable } from 'node:stream';
import type { ReasoningEffort } from '@/core/llm/types.js';
import type { LlmProvider } from '@/core/llm/types.js';
import type { ProviderCredentialSource } from '@/core/runtime/credentials/index.js';
import type { ToolDefinition } from '@/core/types.js';
import type { ConversationEngine } from '../types.js';
import type { ChatSession } from '../../types.js';
import type { ConversationTurnResultSummary } from '../turn-result.js';
import type { ConversationEngineHost, ConversationEngineHostExtension } from '../types.js';

export type ConversationCliMemoryMaintenanceMode = 'none' | 'background' | 'inline';

export type ConversationCliLocalCommandContext = {
  command: string;
  engine: ConversationEngine;
  output: Writable;
  session: ChatSession;
  stateRoot: string;
  workspaceRoot: string;
};

export type ConversationCliLocalCommand = {
  command: string;
  aliases?: string[];
  description: string;
  run(context: ConversationCliLocalCommandContext): void | Promise<void>;
};

export type ConversationCliTurnContext = {
  engine: ConversationEngine;
  prompt: string;
  session: ChatSession;
  stateRoot: string;
  submittedPrompt: string;
  workspaceRoot: string;
};

export type ConversationCliCredentialContext = {
  model: string;
  preferApiKey?: boolean;
  provider: LlmProvider;
  source: ProviderCredentialSource;
};

export type ConversationCliCredentialPreflightOptions = {
  enabled?: boolean;
  missingCredentialHint?: string | ((context: ConversationCliCredentialContext) => string | undefined);
  status?: 'off' | 'status';
};

export type ConversationCliRunnerOptions = {
  model?: string;
  workspaceRoot?: string;
  stateRoot?: string;
  sessionId?: string;
  sessionName?: string;
  promptLabel?: string;
  oncePrompt?: string;
  maxSteps?: number;
  reasoningEffort?: ReasoningEffort | string;
  apiKey?: string;
  preferApiKey?: boolean;
  credentialStorePath?: string;
  credentialPreflight?: boolean | ConversationCliCredentialPreflightOptions;
  systemContext?: string;
  memoryMaintenanceMode?: ConversationCliMemoryMaintenanceMode;
  tools?: ToolDefinition[];
  hostExtensions?: ConversationEngineHostExtension[];
  host?: ConversationEngineHost;
  localCommands?: ConversationCliLocalCommand[];
  formatPrompt?: (prompt: string) => string;
  onTurnStarted?: (context: ConversationCliTurnContext) => void | Promise<void>;
  onTurnFinished?: (context: ConversationCliTurnContext & {
    result: ConversationTurnResultSummary;
  }) => void | Promise<void>;
  input?: Readable;
  output?: Writable;
};

export type ConversationCliRunnerDefaultsInput = Pick<
  ConversationCliRunnerOptions,
  'maxSteps' | 'memoryMaintenanceMode' | 'model' | 'reasoningEffort' | 'stateRoot' | 'workspaceRoot'
> & {
  env?: Pick<
    NodeJS.ProcessEnv,
    'ANTHROPIC_MODEL' | 'HEDDLE_EXAMPLE_MODEL' | 'HEDDLE_MODEL' | 'OPENAI_MODEL'
  >;
};

export type ConversationCliRunnerDefaults = {
  maxSteps: number;
  memoryMaintenanceMode: ConversationCliMemoryMaintenanceMode;
  model: string;
  reasoningEffort?: ReasoningEffort;
  stateRoot: string;
  workspaceRoot: string;
};
