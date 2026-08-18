import type {
  ExecutionHostHeartbeatStreamEvent,
  ExecutionHostHeartbeatTaskRequest,
  ExecutionHostStreamEvent,
} from '../contracts/index.js';

export type ExecutionHostConversationTurn = {
  invocationId: string;
  runtimeSessionId: string;
  prompt: string;
  deadlineAt?: string;
  executionAssertion: string;
  mcpCapability?: string;
  modelApiKey: string;
  signal?: AbortSignal;
};

export interface ExecutionHost {
  streamConversationTurn(
    input: ExecutionHostConversationTurn,
  ): AsyncIterable<ExecutionHostStreamEvent>;
}

export type ExecutionHostHeartbeatTask = Omit<
  ExecutionHostHeartbeatTaskRequest,
  'schemaVersion' | 'kind'
> & {
  runtimeSessionId: string;
  executionAssertion: string;
  mcpCapability?: string;
  modelApiKey: string;
  signal?: AbortSignal;
};

export interface HeartbeatExecutionHost {
  streamHeartbeatTask(
    input: ExecutionHostHeartbeatTask,
  ): AsyncIterable<ExecutionHostHeartbeatStreamEvent>;
}

export type DirectHttpExecutionHostConfig = {
  baseUrl: URL;
  localToken: string;
  fetch?: typeof fetch;
};
