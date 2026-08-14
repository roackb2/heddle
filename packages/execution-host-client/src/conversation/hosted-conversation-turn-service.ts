import {
  CONVERSATION_TURN_WORKFLOW,
  McpAllowedToolsSchema,
} from '../contracts/index.js';
import type {
  HostedConversationTurnRunner,
  HostedConversationTurnServiceConfig,
} from './types.js';
import { HostedConversationTurnInputSchema } from './types.js';

export class HostedConversationConfigurationError extends Error {
  readonly name = 'HostedConversationConfigurationError';
}

/**
 * Provider-neutral application service for one externally hosted turn.
 *
 * It binds authority, optional product-tool policy, model credentials, and the
 * Execution Host stream while leaving product admission and settlement to the
 * adopter.
 */
export class HostedConversationTurnService
implements HostedConversationTurnRunner {
  readonly #authority: HostedConversationTurnServiceConfig['authority'];
  readonly #executionHost: HostedConversationTurnServiceConfig['executionHost'];
  readonly #modelCredentials: HostedConversationTurnServiceConfig[
    'modelCredentials'
  ];
  readonly #allowedTools: readonly string[] | undefined;

  constructor(config: HostedConversationTurnServiceConfig) {
    this.#authority = config.authority;
    this.#executionHost = config.executionHost;
    this.#modelCredentials = config.modelCredentials;
    this.#allowedTools = config.mcp
      ? Object.freeze(McpAllowedToolsSchema.parse(config.mcp.allowedTools))
      : undefined;
  }

  async *streamTurn(
    rawInput: Parameters<HostedConversationTurnRunner['streamTurn']>[0],
  ): ReturnType<HostedConversationTurnRunner['streamTurn']> {
    const input = HostedConversationTurnInputSchema.parse(rawInput);
    input.signal?.throwIfAborted();
    const issued = await this.#authority.issue({
      scope: input.scope,
      runtimeSessionId: input.runtimeSessionId,
      invocationId: input.invocationId,
      workflow: CONVERSATION_TURN_WORKFLOW,
      ...(this.#allowedTools
        ? { mcp: { allowedTools: this.#allowedTools } }
        : {}),
    });
    const mcpCapability = issued.mcpCapability();
    if (this.#allowedTools && !mcpCapability) {
      throw new HostedConversationConfigurationError(
        'Hosted conversation tool policy requires an MCP-capable execution authority.',
      );
    }

    const modelApiKey = await this.#modelCredentials.resolveModelApiKey({
      scope: input.scope,
      invocationId: input.invocationId,
      signal: input.signal,
    });
    input.signal?.throwIfAborted();

    yield* this.#executionHost.streamConversationTurn({
      invocationId: input.invocationId,
      runtimeSessionId: input.runtimeSessionId,
      prompt: input.prompt,
      ...(input.deadlineAt ? { deadlineAt: input.deadlineAt } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
      executionAssertion: issued.executionAssertion(),
      ...(mcpCapability ? { mcpCapability } : {}),
      modelApiKey,
    });
  }
}
