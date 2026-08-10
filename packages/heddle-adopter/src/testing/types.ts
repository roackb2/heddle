import type {
  ExecutionHostConversationTurnRequest,
  RuntimePublicResult,
} from '../contracts/index.js';

/**
 * One locally admitted invocation. Credentials remain behind explicit methods
 * so ordinary object inspection and JSON serialization cannot reveal them.
 */
export interface LocalExecutionHostInvocation {
  readonly request: ExecutionHostConversationTurnRequest;
  readonly runtimeSessionId: string;
  readonly signal: AbortSignal;
  mcpCapability(): string | undefined;
  publishActivity(activity: unknown): Promise<void>;
  toJSON(): LocalExecutionHostInvocationMetadata;
}

export type LocalExecutionHostInvocationMetadata = {
  schemaVersion: 1;
  kind: 'conversation-turn';
  invocationId: string;
  runtimeSessionId: string;
};

export type LocalExecutionHostTerminal =
  | {
    kind: 'result';
    result: RuntimePublicResult;
  }
  | {
    kind: 'cancelled';
    reason: string;
  }
  | {
    kind: 'error';
    error: {
      code: string;
      message: string;
    };
  }
  | {
    /** End the SSE response without a terminal event to exercise recovery. */
    kind: 'interrupted';
  };

export type LocalExecutionHostExecutor = (
  invocation: LocalExecutionHostInvocation,
) => LocalExecutionHostTerminal | Promise<LocalExecutionHostTerminal>;

export type LocalExecutionHostContractFixtureOptions = {
  execute: LocalExecutionHostExecutor;
  now?: () => Date;
  createRunId?: () => string;
};
