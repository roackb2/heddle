import { z } from 'zod';
import {
  ExecutionHostConversationTurnRequestSchema,
  ExecutionScopeSchema,
  RuntimeSessionIdSchema,
  type ExecutionHostStreamEvent,
} from '../contracts/index.js';
import type { ExecutionAuthorityIssuer } from '../authority/index.js';
import type { ExecutionHost } from '../http-sse/index.js';

export const HostedConversationTurnInputSchema = z.object({
  scope: ExecutionScopeSchema.omit({ adopterId: true }),
  runtimeSessionId: RuntimeSessionIdSchema,
  invocationId: ExecutionHostConversationTurnRequestSchema.shape.invocationId,
  prompt: ExecutionHostConversationTurnRequestSchema.shape.prompt,
  deadlineAt: ExecutionHostConversationTurnRequestSchema.shape.deadlineAt,
  signal: z.custom<AbortSignal>(
    (value) => value instanceof AbortSignal,
    'signal must be an AbortSignal',
  ).optional(),
}).strict();

export type HostedConversationTurnInput = z.infer<
  typeof HostedConversationTurnInputSchema
>;

export type HostedConversationCredentialContext = Pick<
  HostedConversationTurnInput,
  'scope' | 'invocationId' | 'signal'
>;

/** Resolves model authority without exposing it to HTTP or product data. */
export interface HostedModelCredentialProvider {
  resolveModelApiKey(
    context: HostedConversationCredentialContext,
  ): Promise<string>;
}

/** @deprecated Use `HostedModelCredentialProvider`. */
export type HostedConversationModelCredentialProvider =
  HostedModelCredentialProvider;

export interface HostedConversationTurnRunner {
  streamTurn(
    input: HostedConversationTurnInput,
  ): AsyncIterable<ExecutionHostStreamEvent>;
}

export type HostedConversationTurnServiceConfig = {
  authority: ExecutionAuthorityIssuer;
  executionHost: ExecutionHost;
  modelCredentials: HostedModelCredentialProvider;
  /** Omit this policy when the hosted workflow needs no product MCP tools. */
  mcp?: {
    allowedTools: readonly string[];
  };
};
