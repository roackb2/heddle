import dayjs from 'dayjs';
import { z } from 'zod';
import { HEARTBEAT_TASK_WORKFLOW, OpaqueIdSchema } from '../contracts/index.js';
import {
  HostedHeartbeatDelegationAuthorizationSchema,
  HostedHeartbeatDelegationRequestSchema,
  HostedHeartbeatDelegationSchema,
  type HostedHeartbeatDelegation,
  type HostedHeartbeatDelegationRequest,
} from './contracts.js';
import { createHostedRuntimeSessionId } from './runtime-session.js';
import type {
  HostedHeartbeatDelegationIssuer,
  HostedHeartbeatDelegationServiceConfig,
} from './types.js';

const DelegationServiceConfigSchema = z.object({
  runtimeSessionNamespace: OpaqueIdSchema,
  maxExecutionMs: z.number().int().min(1_000).max(Number.MAX_SAFE_INTEGER),
}).strict();

export class HostedHeartbeatDelegationRejectedError extends Error {
  readonly name = 'HostedHeartbeatDelegationRejectedError';
}

/**
 * Converts one product authorization decision into a fully bound Heddle
 * authority bundle. Product code never constructs the delegation wire shape.
 */
export class HostedHeartbeatDelegationService
implements HostedHeartbeatDelegationIssuer {
  readonly #authority: HostedHeartbeatDelegationServiceConfig['authority'];
  readonly #authorizer: HostedHeartbeatDelegationServiceConfig['authorizer'];
  readonly #runtimeSessionNamespace: string;
  readonly #maxExecutionMs: number;
  readonly #now: () => Date;

  constructor(config: HostedHeartbeatDelegationServiceConfig) {
    const parsed = DelegationServiceConfigSchema.parse({
      runtimeSessionNamespace: config.runtimeSessionNamespace,
      maxExecutionMs: config.maxExecutionMs,
    });
    this.#authority = config.authority;
    this.#authorizer = config.authorizer;
    this.#runtimeSessionNamespace = parsed.runtimeSessionNamespace;
    this.#maxExecutionMs = parsed.maxExecutionMs;
    this.#now = config.now ?? (() => new Date());
  }

  async issue(
    rawInput: HostedHeartbeatDelegationRequest,
    rawSignal?: AbortSignal,
  ): Promise<HostedHeartbeatDelegation> {
    const input = HostedHeartbeatDelegationRequestSchema.parse(rawInput);
    const signal = rawSignal ?? new AbortController().signal;
    signal.throwIfAborted();
    const rawAuthorization = await this.#authorizer.authorize({
      taskId: input.taskId,
      executionId: input.executionId,
      signal,
    });
    if (!rawAuthorization) {
      throw new HostedHeartbeatDelegationRejectedError(
        'The product rejected this heartbeat execution.',
      );
    }
    const authorization = HostedHeartbeatDelegationAuthorizationSchema.parse(
      rawAuthorization,
    );
    const runtimeSessionId = createHostedRuntimeSessionId({
      namespace: this.#runtimeSessionNamespace,
      scope: authorization.scope,
    });
    const deadlineAt = dayjs(this.#now())
      .add(this.#maxExecutionMs, 'millisecond')
      .toISOString();
    const issued = await this.#authority.issue({
      scope: authorization.scope,
      runtimeSessionId,
      invocationId: input.executionId,
      workflow: HEARTBEAT_TASK_WORKFLOW,
      mcp: { allowedTools: authorization.allowedTools },
    });
    signal.throwIfAborted();
    const mcpCapability = issued.mcpCapability();
    if (!mcpCapability || !issued.metadata.mcp) {
      throw new Error(
        'Hosted heartbeat delegation requires an MCP-capable execution authority.',
      );
    }

    return HostedHeartbeatDelegationSchema.parse({
      schemaVersion: 1,
      taskId: input.taskId,
      executionId: input.executionId,
      scope: authorization.scope,
      runtimeSessionId,
      deadlineAt,
      authority: {
        metadata: issued.metadata,
        executionAssertion: issued.executionAssertion(),
        mcpCapability,
      },
    });
  }
}
