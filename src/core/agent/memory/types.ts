import type { ToolCall, ToolResult } from '@/core/types.js';
import type { AgentRunContext, AgentMemoryCheckpointState } from '../types.js';

export type CreateAgentMemoryCheckpointStateArgs = {
  goal: string;
  toolNames: string[];
};

export type TrackAgentMemoryToolResultArgs = {
  context: AgentRunContext;
  effectiveCall: ToolCall;
  result: ToolResult;
};

export type { AgentMemoryCheckpointState };
