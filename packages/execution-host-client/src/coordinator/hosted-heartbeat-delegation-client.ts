import { z } from 'zod';
import type {
  ExecutionAuthorityIssueInput,
  ExecutionAuthorityIssuer,
  IssuedExecutionAuthority,
  IssuedExecutionAuthorityMetadata,
} from '../authority/index.js';
import {
  HEARTBEAT_TASK_WORKFLOW,
  isSafeWebUrl,
} from '../contracts/index.js';
import {
  HostedHeartbeatAgentExecutionTransport,
  HostedHeartbeatTaskService,
  type HostedHeartbeatAgentExecutionTransportInput,
} from '../heartbeat/index.js';
import {
  HOSTED_HEARTBEAT_DELEGATIONS_PATH,
  HostedHeartbeatDelegationRequestSchema,
  HostedHeartbeatDelegationSchema,
  type HostedHeartbeatDelegation,
  type HostedHeartbeatDelegationRequest,
} from './contracts.js';
import { HostedHeartbeatServiceTokenSchema } from './service-token.js';
import type {
  HostedHeartbeatDelegatedExecutionTransportConfig,
  HostedHeartbeatDelegatedExecutionTransportPort,
  HostedHeartbeatDelegationClientConfig,
  HostedHeartbeatDelegationIssuer,
} from './types.js';

const SafeBaseUrlSchema = z.custom<URL>(
  (value) => value instanceof URL && isSafeWebUrl(value),
  'baseUrl must be a safe HTTPS or loopback HTTP URL',
);
const AbsolutePathSchema = z.string().min(1).max(256).regex(
  /^\/(?:[^?#\s]*)$/,
  'must be an absolute path without query, fragment, or whitespace',
);

export class HostedHeartbeatDelegationRequestError extends Error {
  readonly name = 'HostedHeartbeatDelegationRequestError';

  constructor(readonly status: number) {
    super(`Heartbeat delegation failed with status ${status}.`);
  }
}

/** Authenticated coordinator client for one product-issued authority bundle. */
export class HostedHeartbeatDelegationClient
implements HostedHeartbeatDelegationIssuer {
  readonly #endpoint: URL;
  readonly #authorization: string;
  readonly #fetch: typeof globalThis.fetch;

  constructor(config: HostedHeartbeatDelegationClientConfig) {
    const baseUrl = SafeBaseUrlSchema.parse(config.baseUrl);
    this.#endpoint = new URL(
      AbsolutePathSchema.parse(
        config.path ?? HOSTED_HEARTBEAT_DELEGATIONS_PATH,
      ),
      baseUrl,
    );
    this.#authorization = `Bearer ${
      HostedHeartbeatServiceTokenSchema.parse(config.apiToken)
    }`;
    this.#fetch = config.fetch ?? globalThis.fetch;
  }

  async issue(
    rawInput: HostedHeartbeatDelegationRequest,
    signal?: AbortSignal,
  ): Promise<HostedHeartbeatDelegation> {
    const input = HostedHeartbeatDelegationRequestSchema.parse(rawInput);
    const response = await this.#fetch(this.#endpoint, {
      method: 'POST',
      headers: {
        authorization: this.#authorization,
        'content-type': 'application/json',
      },
      body: JSON.stringify(input),
      redirect: 'error',
      signal,
    });
    if (!response.ok) {
      throw new HostedHeartbeatDelegationRequestError(response.status);
    }
    const delegation = HostedHeartbeatDelegationSchema.parse(
      await response.json(),
    );
    if (
      delegation.taskId !== input.taskId
      || delegation.executionId !== input.executionId
    ) {
      throw new Error(
        'Product backend returned a mismatched heartbeat delegation.',
      );
    }
    return delegation;
  }
}

/** Executes a claimed task with the exact product-issued authority bundle. */
export class HostedHeartbeatDelegatedExecutionTransport
implements HostedHeartbeatDelegatedExecutionTransportPort {
  readonly #config: HostedHeartbeatDelegatedExecutionTransportConfig;

  constructor(config: HostedHeartbeatDelegatedExecutionTransportConfig) {
    this.#config = config;
  }

  async execute(
    input: HostedHeartbeatAgentExecutionTransportInput,
  ): Promise<unknown> {
    const delegation = await this.#config.delegations.issue({
      schemaVersion: 1,
      taskId: input.request.taskId,
      executionId: input.request.executionId,
    }, input.signal);
    const service = new HostedHeartbeatTaskService({
      authority: new DelegatedExecutionAuthorityIssuer(delegation),
      executionHost: this.#config.executionHost,
      modelCredentials: this.#config.modelCredentials,
      mcp: {
        allowedTools: delegation.authority.metadata.mcp.allowedTools,
      },
    });
    const transport = new HostedHeartbeatAgentExecutionTransport({
      runner: service,
      resolveInvocationContext: () => ({
        scope: delegation.scope,
        runtimeSessionId: delegation.runtimeSessionId,
        deadlineAt: delegation.deadlineAt,
      }),
    });
    return await transport.execute(input);
  }
}

/** Ensures downstream execution cannot widen a delegated authority bundle. */
class DelegatedExecutionAuthorityIssuer implements ExecutionAuthorityIssuer {
  constructor(private readonly delegation: HostedHeartbeatDelegation) {}

  async issue(
    input: ExecutionAuthorityIssueInput,
  ): Promise<IssuedExecutionAuthority> {
    const metadata = this.delegation.authority.metadata;
    if (
      input.workflow !== HEARTBEAT_TASK_WORKFLOW
      || input.workflow !== metadata.workflow
      || input.invocationId !== metadata.invocationId
      || input.runtimeSessionId !== metadata.runtimeSessionId
      || !sameScope(input.scope, this.delegation.scope)
      || !sameScope(input.scope, metadata.scope)
      || !sameTools(input.mcp?.allowedTools, metadata.mcp.allowedTools)
    ) {
      throw new Error('Heartbeat delegation does not match Heddle execution.');
    }
    const authority = this.delegation.authority;
    return Object.freeze({
      metadata: metadata as IssuedExecutionAuthorityMetadata,
      executionAssertion: () => authority.executionAssertion,
      mcpCapability: () => authority.mcpCapability,
      toJSON: () => metadata as IssuedExecutionAuthorityMetadata,
    });
  }
}

function sameScope(
  left: ExecutionAuthorityIssueInput['scope'],
  right: HostedHeartbeatDelegation['scope']
    | HostedHeartbeatDelegation['authority']['metadata']['scope'],
): boolean {
  return left.tenantId === right.tenantId
    && left.subjectId === right.subjectId
    && left.productSessionId === right.productSessionId;
}

function sameTools(
  left: readonly string[] | undefined,
  right: readonly string[],
): boolean {
  return Boolean(
    left
    && left.length === right.length
    && left.every((tool, index) => tool === right[index]),
  );
}
