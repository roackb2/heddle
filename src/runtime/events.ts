import type { ChatMessage, LlmProvider, LlmUsage } from '../llm/types.js';
import type { RunResult, StopReason, TraceEvent } from '../types.js';

export type AgentLoopStatus = 'finished';

export type AgentLoopState = {
  status: AgentLoopStatus;
  goal: string;
  model: string;
  provider: LlmProvider;
  workspaceRoot: string;
  startedAt: string;
  finishedAt: string;
  outcome: StopReason;
  summary: string;
  usage?: LlmUsage;
  transcript: ChatMessage[];
  trace: TraceEvent[];
};

export type AgentLoopCheckpoint = {
  version: 1;
  createdAt: string;
  state: AgentLoopState;
};

export type AgentLoopEvent =
  | {
      type: 'loop.started';
      goal: string;
      model: string;
      provider: LlmProvider;
      workspaceRoot: string;
      timestamp: string;
    }
  | {
      type: 'assistant.stream';
      step: number;
      text: string;
      done: boolean;
      timestamp: string;
    }
  | {
      type: 'trace';
      event: TraceEvent;
      timestamp: string;
    }
  | {
      type: 'loop.finished';
      outcome: RunResult['outcome'];
      summary: string;
      usage: RunResult['usage'];
      state: AgentLoopState;
      timestamp: string;
    };

export function createFinishedAgentLoopState(args: {
  goal: string;
  model: string;
  provider: LlmProvider;
  workspaceRoot: string;
  startedAt: string;
  finishedAt: string;
  result: RunResult;
}): AgentLoopState {
  return {
    status: 'finished',
    goal: args.goal,
    model: args.model,
    provider: args.provider,
    workspaceRoot: args.workspaceRoot,
    startedAt: args.startedAt,
    finishedAt: args.finishedAt,
    outcome: args.result.outcome,
    summary: args.result.summary,
    usage: args.result.usage,
    transcript: args.result.transcript,
    trace: args.result.trace,
  };
}

export function createAgentLoopCheckpoint(
  state: AgentLoopState,
  options: { createdAt?: string } = {},
): AgentLoopCheckpoint {
  return {
    version: 1,
    createdAt: options.createdAt ?? new Date().toISOString(),
    state,
  };
}

export function getHistoryFromAgentLoopState(state: AgentLoopState): ChatMessage[] {
  return state.transcript;
}

export function getHistoryFromAgentLoopCheckpoint(checkpoint: AgentLoopCheckpoint): ChatMessage[] {
  return getHistoryFromAgentLoopState(checkpoint.state);
}
