// ---------------------------------------------------------------------------
// Heddle v0 — Core Types
// Minimal types only. No premature abstractions.
// ---------------------------------------------------------------------------

import type { ChatMessage, LlmUsage } from './llm/types.js';

/**
 * Input to the agent loop.
 */
export type RunInput = {
  goal: string;
  maxSteps?: number;
};

/**
 * A tool the agent can invoke.
 */
export type ToolDefinition = {
  name: string;
  description: string;
  requiresApproval?: boolean;
  parameters: Record<string, unknown>; // JSON Schema object
  execute: (input: unknown) => Promise<ToolResult>;
};

/**
 * What the model asked the runtime to do.
 */
export type ToolCall = {
  id: string;
  tool: string;
  input: unknown;
};

/**
 * Optional self-reported assistant diagnostics for observability.
 */
export type AssistantDiagnostics = {
  rationale?: string;
  missing?: string[];
  wantedTools?: string[];
  wantedInputs?: string[];
};

/**
 * What came back from executing a tool.
 */
export type ToolResult = {
  ok: boolean;
  output?: unknown;
  error?: string;
};

/**
 * Why the run stopped.
 */
export type StopReason = 'done' | 'max_steps' | 'error' | 'interrupted';

/**
 * A single event in the run trace. Discriminated union on `type`.
 */
export type TraceEvent =
  | { type: 'run.started'; goal: string; timestamp: string }
  | {
      type: 'assistant.turn';
      content: string;
      requestedTools: boolean;
      diagnostics?: AssistantDiagnostics;
      toolCalls?: ToolCall[];
      step: number;
      timestamp: string;
    }
  | {
      type: 'host.warning';
      code: 'actionless_completion';
      message: string;
      details?: Record<string, unknown>;
      step: number;
      timestamp: string;
    }
  | { type: 'tool.approval_requested'; call: ToolCall; step: number; timestamp: string }
  | {
      type: 'tool.approval_resolved';
      call: ToolCall;
      approved: boolean;
      reason?: string;
      step: number;
      timestamp: string;
    }
  | {
      type: 'tool.fallback';
      fromCall: ToolCall;
      toCall: ToolCall;
      reason: string;
      step: number;
      timestamp: string;
    }
  | { type: 'tool.call'; call: ToolCall; step: number; timestamp: string }
  | { type: 'tool.result'; tool: string; result: ToolResult; step: number; timestamp: string }
  | {
      type: 'memory.candidate_recorded';
      candidateId: string;
      path: string;
      step: number;
      timestamp: string;
    }
  | {
      type: 'memory.checkpoint_skipped';
      rationale: string;
      step: number;
      timestamp: string;
    }
  | {
      type: 'memory.maintenance_started';
      runId: string;
      candidateIds: string[];
      step: number;
      timestamp: string;
    }
  | {
      type: 'memory.maintenance_finished';
      runId: string;
      outcome: StopReason | 'skipped';
      summary: string;
      processedCandidateIds: string[];
      failedCandidateIds: string[];
      step: number;
      timestamp: string;
    }
  | {
      type: 'memory.maintenance_failed';
      runId: string;
      error: string;
      candidateIds: string[];
      step: number;
      timestamp: string;
    }
  | {
      type: 'cyberloop.annotation';
      step: number;
      frameKind: string;
      driftLevel: 'unknown' | 'low' | 'medium' | 'high';
      requestedHalt: boolean;
      metadata: Record<string, unknown>;
      timestamp: string;
    }
  | { type: 'run.finished'; outcome: StopReason; summary: string; step: number; timestamp: string };

/**
 * The result returned from `runAgent`.
 */
export type RunResult = {
  outcome: StopReason;
  summary: string;
  trace: TraceEvent[];
  transcript: ChatMessage[];
  usage?: LlmUsage;
};
