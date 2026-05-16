import type { ToolCall } from '@/core/types.js';

export type MutationState = {
  executedMutationCommands: string[];
};

export type TrackAgentMutationResultArgs = {
  state: MutationState;
  effectiveCall: ToolCall;
  result: { ok: boolean; output?: unknown };
};
