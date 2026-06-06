// ---------------------------------------------------------------------------
// Heddle v0 — Core Types
// Minimal types only. No premature abstractions.
// ---------------------------------------------------------------------------

import type { ChatMessage, LlmUsage } from './llm/types.js';
import { HeddleEventType } from './event-types.js';

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
  | { type: typeof HeddleEventType.runStarted; goal: string; timestamp: string }
  | {
      type: typeof HeddleEventType.assistantTurn;
      content: string;
      requestedTools: boolean;
      diagnostics?: AssistantDiagnostics;
      toolCalls?: ToolCall[];
      step: number;
      timestamp: string;
    }
  | {
      type: typeof HeddleEventType.modelRetry;
      reason: 'transport_error' | 'empty_response';
      attempt: number;
      maxAttempts: number;
      retryAfterMs: number;
      message: string;
      step: number;
      timestamp: string;
    }
  | {
      type: typeof HeddleEventType.hostWarning;
      code: 'actionless_completion';
      message: string;
      details?: Record<string, unknown>;
      step: number;
      timestamp: string;
    }
  | { type: typeof HeddleEventType.toolApprovalRequested; call: ToolCall; step: number; timestamp: string }
  | {
      type: typeof HeddleEventType.toolApprovalResolved;
      call: ToolCall;
      approved: boolean;
      reason?: string;
      step: number;
      timestamp: string;
    }
  | {
      type: typeof HeddleEventType.toolFallback;
      fromCall: ToolCall;
      toCall: ToolCall;
      reason: string;
      step: number;
      timestamp: string;
    }
  | { type: typeof HeddleEventType.toolCalling; call: ToolCall; requiresApproval: boolean; step: number; timestamp: string }
  | {
      type: typeof HeddleEventType.toolCompleted;
      call: ToolCall;
      result: ToolResult;
      durationMs?: number;
      step: number;
      timestamp: string;
    }
  | {
      type: typeof HeddleEventType.memoryCandidateRecorded;
      candidateId: string;
      path: string;
      step: number;
      timestamp: string;
    }
  | {
      type: typeof HeddleEventType.memoryCheckpointSkipped;
      rationale: string;
      step: number;
      timestamp: string;
    }
  | {
      type: typeof HeddleEventType.memoryMaintenanceStarted;
      runId: string;
      candidateIds: string[];
      step: number;
      timestamp: string;
    }
  | {
      type: typeof HeddleEventType.memoryMaintenanceFinished;
      runId: string;
      outcome: StopReason | 'skipped';
      summary: string;
      processedCandidateIds: string[];
      failedCandidateIds: string[];
      step: number;
      timestamp: string;
    }
  | {
      type: typeof HeddleEventType.memoryMaintenanceFailed;
      runId: string;
      error: string;
      candidateIds: string[];
      step: number;
      timestamp: string;
    }
  | {
      type: typeof HeddleEventType.cyberloopAnnotation;
      step: number;
      frameKind: string;
      driftLevel: 'unknown' | 'low' | 'medium' | 'high';
      requestedHalt: boolean;
      metadata: Record<string, unknown>;
      timestamp: string;
    }
  | { type: typeof HeddleEventType.runFinished; outcome: StopReason; summary: string; step: number; timestamp: string };

/**
 * The result returned from `AgentRunService.run`.
 */
export type RunResult = {
  outcome: StopReason;
  summary: string;
  trace: TraceEvent[];
  transcript: ChatMessage[];
  usage?: LlmUsage;
};
