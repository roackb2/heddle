import type { ExecutionHostStreamEvent } from '../contracts/index.js';

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

export type DirectHttpExecutionHostConfig = {
  baseUrl: URL;
  localToken: string;
  fetch?: typeof fetch;
};
