import type {
  ExecutionHostConversationTurnRequest,
  ExecutionHostHeartbeatTaskRequest,
  RuntimePublicResult,
} from '../../contracts/index.js';
import type { VerifiedExecutionHostMcpCapability } from '../types.js';

type RuntimeExecutionStreamEnvelope = {
  runId: string;
  sequence: number;
  timestamp: string;
};

/** Ordered execution events exposed by any workflow executor. */
export type RuntimeExecutionStreamItem<Result = unknown> =
  | (RuntimeExecutionStreamEnvelope & {
    kind: 'activity';
    activity: unknown;
  })
  | (RuntimeExecutionStreamEnvelope & {
    kind: 'result';
    result: Result;
  })
  | (RuntimeExecutionStreamEnvelope & {
    kind: 'cancelled';
    reason: string;
  })
  | (RuntimeExecutionStreamEnvelope & {
    kind: 'error';
    error: { code: string; message: string };
  });

export type RuntimeInvocationRequest =
  | ExecutionHostConversationTurnRequest
  | ExecutionHostHeartbeatTaskRequest;

export type RuntimeExecutionInput<
  Request extends RuntimeInvocationRequest = RuntimeInvocationRequest,
> = {
  scopeKey: string;
  executionSessionId: string;
  request: Request;
  modelApiKey: string;
  mcpCapability?: VerifiedExecutionHostMcpCapability;
  abortSignal: AbortSignal;
};

export type RuntimeExecutionHandle<Result = unknown> = {
  runId: string;
  result: Promise<Result>;
  events(options?: {
    signal?: AbortSignal;
  }): AsyncIterable<RuntimeExecutionStreamItem<Result>>;
  cancel(): boolean;
};

/** Outbound execution port for one provider-neutral workflow. */
export type RuntimeWorkflowExecutor<
  Request extends RuntimeInvocationRequest,
  Result,
> = {
  start(
    input: RuntimeExecutionInput<Request>,
  ): Promise<RuntimeExecutionHandle<Result>>;
};

export type RuntimeWorkflowExecutors<HeartbeatResult = unknown> = {
  conversationTurn: RuntimeWorkflowExecutor<
    ExecutionHostConversationTurnRequest,
    RuntimePublicResult
  >;
  heartbeatTask: RuntimeWorkflowExecutor<
    ExecutionHostHeartbeatTaskRequest,
    HeartbeatResult
  >;
};

export type RuntimeInvocationHandle<Result = unknown> = {
  runId: string;
  acceptedAt: string;
  events(): AsyncIterable<RuntimeExecutionStreamItem<Result>>;
  cancel(): boolean;
  result: Promise<Result>;
};

export type RuntimeSessionConfig = {
  maxInvocationMs: number;
};
