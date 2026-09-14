import type { ChatMessage } from '@/core/llm/types.js';
import type { AgentPromptComposition } from '@/core/prompts/system-prompt.js';
import type { RunAgentOptions, AgentRunContext } from '../types.js';

export type BuildAgentRunContextArgs = RunAgentOptions;

export type BuildInitialAgentMessagesArgs = {
  goal: string;
  toolNames: string[];
  systemContext?: string;
  promptComposition?: AgentPromptComposition;
  history?: ChatMessage[];
};

export type { AgentRunContext };
