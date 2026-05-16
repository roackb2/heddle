import type { ChatMessage } from '@/core/llm/types.js';
import type { RunAgentOptions, AgentRunContext } from '../types.js';

export type BuildAgentRunContextArgs = RunAgentOptions;

export type BuildInitialAgentMessagesArgs = {
  goal: string;
  toolNames: string[];
  systemContext?: string;
  history?: ChatMessage[];
};

export type { AgentRunContext };
