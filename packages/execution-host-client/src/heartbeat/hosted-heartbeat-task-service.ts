import {
  HEARTBEAT_TASK_WORKFLOW,
  McpAllowedToolsSchema,
} from '../contracts/index.js';
import { ExecutionHostInvocationCancelledError } from '../http-sse/index.js';
import {
  HostedHeartbeatTaskInputSchema,
  type HostedHeartbeatTaskInput,
  type HostedHeartbeatTaskRunner,
  type HostedHeartbeatTaskServiceConfig,
} from './types.js';

export class HostedHeartbeatConfigurationError extends Error {
  readonly name = 'HostedHeartbeatConfigurationError';
}

export class HostedHeartbeatExecutionError extends Error {
  readonly name = 'HostedHeartbeatExecutionError';

  constructor(readonly code: string) {
    super('Execution Host heartbeat task failed.');
  }
}

/**
 * Provider-neutral application service for one remotely executed heartbeat.
 *
 * It owns authority issuance, optional product-tool policy, model credentials,
 * ordered stream consumption, cancellation, and terminal classification. The
 * caller owns product scope/session mapping and the durable heartbeat store.
 */
export class HostedHeartbeatTaskService
implements HostedHeartbeatTaskRunner {
  readonly #authority: HostedHeartbeatTaskServiceConfig['authority'];
  readonly #executionHost: HostedHeartbeatTaskServiceConfig['executionHost'];
  readonly #modelCredentials: HostedHeartbeatTaskServiceConfig[
    'modelCredentials'
  ];
  readonly #allowedTools: readonly string[] | undefined;

  constructor(config: HostedHeartbeatTaskServiceConfig) {
    this.#authority = config.authority;
    this.#executionHost = config.executionHost;
    this.#modelCredentials = config.modelCredentials;
    this.#allowedTools = config.mcp
      ? Object.freeze(McpAllowedToolsSchema.parse(config.mcp.allowedTools))
      : undefined;
  }

  async execute(
    rawInput: HostedHeartbeatTaskInput,
  ): Promise<unknown> {
    const input = HostedHeartbeatTaskInputSchema.parse(rawInput);
    input.signal?.throwIfAborted();
    const issued = await this.#authority.issue({
      scope: input.scope,
      runtimeSessionId: input.runtimeSessionId,
      invocationId: input.invocationId,
      workflow: HEARTBEAT_TASK_WORKFLOW,
      ...(this.#allowedTools
        ? { mcp: { allowedTools: this.#allowedTools } }
        : {}),
    });
    const mcpCapability = issued.mcpCapability();
    if (this.#allowedTools && !mcpCapability) {
      throw new HostedHeartbeatConfigurationError(
        'Hosted heartbeat tool policy requires an MCP-capable execution authority.',
      );
    }
    const modelApiKey = await this.#modelCredentials.resolveModelApiKey({
      scope: input.scope,
      invocationId: input.invocationId,
      signal: input.signal,
    });
    input.signal?.throwIfAborted();

    for await (const event of this.#executionHost.streamHeartbeatTask({
      invocationId: input.invocationId,
      runtimeSessionId: input.runtimeSessionId,
      taskId: input.taskId,
      task: input.task,
      ...(input.checkpoint ? { checkpoint: input.checkpoint } : {}),
      runContext: input.runContext,
      ...(input.model ? { model: input.model } : {}),
      ...(input.reasoningEffort
        ? { reasoningEffort: input.reasoningEffort }
        : {}),
      ...(input.maxSteps !== undefined ? { maxSteps: input.maxSteps } : {}),
      ...(input.searchIgnoreDirs
        ? { searchIgnoreDirs: input.searchIgnoreDirs }
        : {}),
      ...(input.systemContext ? { systemContext: input.systemContext } : {}),
      ...(input.deadlineAt ? { deadlineAt: input.deadlineAt } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
      executionAssertion: issued.executionAssertion(),
      ...(mcpCapability ? { mcpCapability } : {}),
      modelApiKey,
    })) {
      if (event.kind === 'activity') {
        input.publishActivity?.(event.activity);
        continue;
      }
      if (event.kind === 'result') {
        return event.result;
      }
      if (event.kind === 'cancelled') {
        throw new ExecutionHostInvocationCancelledError();
      }
      if (event.kind === 'error') {
        throw new HostedHeartbeatExecutionError(event.error.code);
      }
    }
    throw new HostedHeartbeatExecutionError('missing_terminal_result');
  }
}
