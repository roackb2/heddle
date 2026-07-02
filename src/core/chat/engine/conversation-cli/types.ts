import type { Readable, Writable } from 'node:stream';
import type { ReasoningEffort } from '@/core/llm/types.js';
import type { ToolDefinition } from '@/core/types.js';
import type { ConversationEngineHost, ConversationEngineHostExtension } from '../types.js';

export type ConversationCliRunnerOptions = {
  model: string;
  workspaceRoot?: string;
  stateRoot?: string;
  sessionName?: string;
  promptLabel?: string;
  maxSteps?: number;
  reasoningEffort?: ReasoningEffort;
  apiKey?: string;
  preferApiKey?: boolean;
  systemContext?: string;
  tools?: ToolDefinition[];
  hostExtensions?: ConversationEngineHostExtension[];
  host?: ConversationEngineHost;
  input?: Readable;
  output?: Writable;
};
