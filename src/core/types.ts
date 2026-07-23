// ---------------------------------------------------------------------------
// Heddle v0 — Core Types
// Minimal types only. No premature abstractions.
// ---------------------------------------------------------------------------

import type { ChatMessage, LlmUsage } from './llm/types.js';
import { HeddleEventType } from './event-types.js';
import type { AutonomyEvaluation, AutonomyPostflightAudit } from './approvals/autonomy/index.js';
import type { ToolPolicyHostContext } from './tools/policy-envelope/types.js';

/**
 * Input to the agent loop.
 */
export type RunInput = {
  goal: string;
  maxSteps?: number;
  maxToolConcurrency?: number;
};

export type ToolConcurrencyMode = 'serial' | 'parallel-safe';

/**
 * A tool the agent can invoke.
 */
export type ToolExecutionContext = {
  /**
   * Aborted when the owning run is cancelled or the tool execution times out.
   * Tool implementations should forward this signal to cancellable I/O.
   */
  signal?: AbortSignal;
};

export type ToolDefinition = {
  name: string;
  description: string;
  requiresApproval?: boolean;
  capabilities?: string[];
  /**
   * Defaults to `serial`. `parallel-safe` is an explicit guarantee from the
   * tool owner that separate calls may overlap without conflicting effects or
   * shared mutable state.
   */
  concurrency?: ToolConcurrencyMode;
  parameters: Record<string, unknown>; // JSON Schema object
  /** Immutable execution provenance owned by the host, never by the model. */
  hostPolicy?: ToolPolicyHostContext;
  /** Resolve host provenance for broker tools whose authority is input-selected. */
  resolveHostPolicy?: (input: unknown) => ToolPolicyHostContext | undefined;
  execute: (input: unknown, context?: ToolExecutionContext) => Promise<ToolResult>;
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

/** Safe host-facing classification for a failed run. Never contains provider messages or credentials. */
export type ModelRunFailureCode =
  | 'authentication'
  | 'permission'
  | 'quota'
  | 'rate_limit'
  | 'request'
  | 'transport'
  | 'empty_response'
  | 'unknown';

export type RunFailure = {
  source: 'model';
  code: ModelRunFailureCode;
};

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
  | {
      type: typeof HeddleEventType.autonomyDecision;
      evaluation: AutonomyEvaluation;
      step: number;
      timestamp: string;
    }
  | {
      type: typeof HeddleEventType.autonomyPostflight;
      audit: AutonomyPostflightAudit;
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
  | {
      type: typeof HeddleEventType.runFinished;
      outcome: StopReason;
      summary: string;
      failure?: RunFailure;
      step: number;
      timestamp: string;
    };

/**
 * The result returned from `AgentRunService.run`.
 */
export type RunResult = {
  outcome: StopReason;
  summary: string;
  failure?: RunFailure;
  trace: TraceEvent[];
  transcript: ChatMessage[];
  usage?: LlmUsage;
};
