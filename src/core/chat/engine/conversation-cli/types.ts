import type { Readable, Writable } from 'node:stream';
import type { ReasoningEffort } from '@/core/llm/types.js';
import type { ToolDefinition } from '@/core/types.js';
import type { ConversationEngine } from '../types.js';
import type { ChatSession } from '../../types.js';
import type { ConversationTurnResultSummary } from '../turn-result.js';
import type { ConversationEngineHost, ConversationEngineHostExtension } from '../types.js';

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

export type ConversationCliRunnerOptions = {
  model: string;
  workspaceRoot?: string;
  stateRoot?: string;
  sessionId?: string;
  sessionName?: string;
  promptLabel?: string;
  oncePrompt?: string;
  maxSteps?: number;
  reasoningEffort?: ReasoningEffort;
  apiKey?: string;
  preferApiKey?: boolean;
  systemContext?: string;
  memoryMaintenanceMode?: 'none' | 'background' | 'inline';
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
