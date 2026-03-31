// ---------------------------------------------------------------------------
// Heddle v0 — Core Types
// Minimal types only. No premature abstractions.
// ---------------------------------------------------------------------------

import type { ChatMessage } from './llm/types.js';

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
export type StopReason = 'done' | 'max_steps' | 'error';

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
  | { type: 'tool.approval_requested'; call: ToolCall; step: number; timestamp: string }
  | {
      type: 'tool.approval_resolved';
      call: ToolCall;
      approved: boolean;
      reason?: string;
      step: number;
      timestamp: string;
    }
  | { type: 'tool.call'; call: ToolCall; step: number; timestamp: string }
  | { type: 'tool.result'; tool: string; result: ToolResult; step: number; timestamp: string }
  | { type: 'run.finished'; outcome: StopReason; summary: string; step: number; timestamp: string };

/**
 * The result returned from `runAgent`.
 */
export type RunResult = {
  outcome: StopReason;
  summary: string;
  trace: TraceEvent[];
  transcript: ChatMessage[];
};
