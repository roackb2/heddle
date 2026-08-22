import { z } from 'zod';
import type { ExecutionAuthorityIssuer } from '../authority/index.js';
import {
  ExecutionHostHeartbeatTaskRequestSchema,
  ExecutionScopeSchema,
  RuntimeSessionIdSchema,
} from '../contracts/index.js';
import type { HostedModelCredentialProvider } from '../conversation/index.js';
import type { HeartbeatExecutionHost } from '../http-sse/index.js';

export const HostedHeartbeatTaskInputSchema =
  ExecutionHostHeartbeatTaskRequestSchema.omit({
    schemaVersion: true,
    kind: true,
  }).extend({
    scope: ExecutionScopeSchema.omit({ adopterId: true }),
    runtimeSessionId: RuntimeSessionIdSchema,
    signal: z.custom<AbortSignal>(
      (value) => value instanceof AbortSignal,
      'signal must be an AbortSignal',
    ).optional(),
    publishActivity: z.custom<(activity: unknown) => void>(
      (value) => typeof value === 'function',
      'publishActivity must be a function',
    ).optional(),
  }).strict();

export type HostedHeartbeatTaskInput = z.infer<
  typeof HostedHeartbeatTaskInputSchema
>;

export interface HostedHeartbeatTaskRunner {
  execute(input: HostedHeartbeatTaskInput): Promise<unknown>;
}

export type HostedHeartbeatTaskServiceConfig = {
  authority: ExecutionAuthorityIssuer;
  executionHost: HeartbeatExecutionHost;
  modelCredentials: HostedModelCredentialProvider;
  /** Omit this policy when the heartbeat workflow needs no product MCP tools. */
  mcp?: {
    allowedTools: readonly string[];
  };
};

export const HostedHeartbeatInvocationContextSchema = z.object({
  scope: ExecutionScopeSchema.omit({ adopterId: true }),
  runtimeSessionId: RuntimeSessionIdSchema,
  deadlineAt: ExecutionHostHeartbeatTaskRequestSchema.shape.deadlineAt,
}).strict();

export type HostedHeartbeatInvocationContext = z.infer<
  typeof HostedHeartbeatInvocationContextSchema
>;

export type HostedHeartbeatAgentExecutionRequest = Omit<
  HostedHeartbeatTaskInput,
  | 'scope'
  | 'runtimeSessionId'
  | 'invocationId'
  | 'deadlineAt'
  | 'signal'
  | 'publishActivity'
  | 'checkpoint'
> & {
  executionId: string;
  checkpoint?: unknown;
};

export type HostedHeartbeatAgentExecutionTransportInput = {
  request: HostedHeartbeatAgentExecutionRequest;
  signal: AbortSignal;
  publishActivity: (activity: unknown) => void;
};

export type HostedHeartbeatAgentExecutionTransportConfig = {
  runner: HostedHeartbeatTaskRunner;
  resolveInvocationContext(input: {
    taskId: string;
    executionId: string;
    signal: AbortSignal;
  }): HostedHeartbeatInvocationContext
    | Promise<HostedHeartbeatInvocationContext>;
};
