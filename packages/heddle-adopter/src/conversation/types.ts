import type {
  ExecutionHostStreamEvent,
  ExecutionScope,
} from '../contracts/index.js';
import type { ExecutionAuthority } from '../authority/index.js';
import type { ExecutionHost } from '../http-sse/index.js';

export type HostedConversationTurnInput = {
  scope: Omit<ExecutionScope, 'adopterId'>;
  runtimeSessionId: string;
  invocationId: string;
  prompt: string;
  deadlineAt?: string;
  signal?: AbortSignal;
};

export type HostedConversationCredentialContext = Pick<
  HostedConversationTurnInput,
  'scope' | 'invocationId' | 'signal'
>;

/** Resolves model authority without exposing it to HTTP or product data. */
export interface HostedConversationModelCredentialProvider {
  resolveModelApiKey(
    context: HostedConversationCredentialContext,
  ): Promise<string>;
}

export interface HostedConversationTurnRunner {
  streamTurn(
    input: HostedConversationTurnInput,
  ): AsyncIterable<ExecutionHostStreamEvent>;
}

export type HostedConversationTurnServiceConfig = {
  authority: ExecutionAuthority;
  executionHost: ExecutionHost;
  modelCredentials: HostedConversationModelCredentialProvider;
  /** Omit this policy when the hosted workflow needs no product MCP tools. */
  mcp?: {
    allowedTools: readonly string[];
  };
};
