import type { ChatMessage, LlmProvider, LlmUsage } from '../../llm/types.js';
import type { RunResult, StopReason, TraceEvent } from '../../types.js';

export type AgentLoopStatus = 'finished';

export type AgentLoopState = {
  status: AgentLoopStatus;
  runId: string;
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
  runId: string;
  createdAt: string;
  state: AgentLoopState;
};

/**
 * Host-facing agent loop events.
 * Stable payload shapes for external integration (CyberLoop, Lucid, etc.)
 */
export type AgentLoopEvent =
  | {
      type: 'loop.started';
      runId: string;
      goal: string;
      model: string;
      provider: LlmProvider;
      workspaceRoot: string;
      resumedFromCheckpoint?: string;
      timestamp: string;
    }
  | {
      type: 'loop.resumed';
      runId: string;
      fromCheckpoint: string;
      priorTraceEvents: number;
      timestamp: string;
    }
  | {
      type: 'assistant.stream';
      runId: string;
      step: number;
      text: string;
      done: boolean;
      timestamp: string;
    }
  | {
      type: 'tool.calling';
      runId: string;
      step: number;
      tool: string;
      toolCallId: string;
      input: unknown;
      requiresApproval: boolean;
      timestamp: string;
    }
  | {
      type: 'tool.completed';
      runId: string;
      step: number;
      tool: string;
      toolCallId: string;
      result: { ok: boolean; output?: unknown; error?: string };
      durationMs: number;
      timestamp: string;
    }
  | {
      type: 'trace';
      runId: string;
      event: TraceEvent;
      timestamp: string;
    }
  | {
      type: 'checkpoint.saved';
      runId: string;
      checkpoint: AgentLoopCheckpoint;
      step: number;
      timestamp: string;
    }
  | {
      type: 'escalation.required';
      runId: string;
      task: string;
      outcome: StopReason;
      summary: string;
      step: number;
      timestamp: string;
    }
  | {
      type: 'heartbeat.decision';
      runId: string;
      decision: 'continue' | 'pause' | 'complete' | 'escalate';
      outcome: StopReason;
      summary: string;
      timestamp: string;
    }
  | {
      type: 'loop.finished';
      runId: string;
      outcome: RunResult['outcome'];
      summary: string;
      usage: RunResult['usage'];
      state: AgentLoopState;
      timestamp: string;
    };

export function createFinishedAgentLoopState(args: {
  runId: string;
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
    runId: args.runId,
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
    runId: state.runId,
    createdAt: options.createdAt ?? new Date().toISOString(),
    state,
  };
}

/**
 * Generate a unique run ID for event correlation.
 * Format: run_<timestamp>_<random>
 */
export function generateRunId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 6);
  return `run_${timestamp}_${random}`;
}

export function getHistoryFromAgentLoopState(state: AgentLoopState): ChatMessage[] {
  return state.transcript;
}

export function getHistoryFromAgentLoopCheckpoint(checkpoint: AgentLoopCheckpoint): ChatMessage[] {
  return getHistoryFromAgentLoopState(checkpoint.state);
}
