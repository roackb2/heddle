import { OpaqueIdSchema } from '../contracts/index.js';
import {
  HostedHeartbeatInvocationContextSchema,
  HostedHeartbeatTaskInputSchema,
  type HostedHeartbeatAgentExecutionTransportConfig,
  type HostedHeartbeatAgentExecutionTransportInput,
} from './types.js';

/**
 * Binds Heddle's provider-neutral scheduler transport to hosted execution.
 *
 * Product code supplies only authorized scope/session resolution. This class
 * owns execution-id correlation and delegates authority, credentials, and
 * stream semantics to `HostedHeartbeatTaskService`.
 */
export class HostedHeartbeatAgentExecutionTransport {
  readonly #runner: HostedHeartbeatAgentExecutionTransportConfig['runner'];
  readonly #resolveInvocationContext: HostedHeartbeatAgentExecutionTransportConfig[
    'resolveInvocationContext'
  ];

  constructor(config: HostedHeartbeatAgentExecutionTransportConfig) {
    this.#runner = config.runner;
    this.#resolveInvocationContext = config.resolveInvocationContext;
  }

  async execute(
    input: HostedHeartbeatAgentExecutionTransportInput,
  ): Promise<unknown> {
    input.signal.throwIfAborted();
    const { executionId: rawExecutionId, ...request } = input.request;
    const executionId = OpaqueIdSchema.parse(rawExecutionId);
    const context = HostedHeartbeatInvocationContextSchema.parse(
      await this.#resolveInvocationContext({
        taskId: input.request.taskId,
        executionId,
        signal: input.signal,
      }),
    );
    input.signal.throwIfAborted();
    return await this.#runner.execute(HostedHeartbeatTaskInputSchema.parse({
      ...request,
      invocationId: executionId,
      scope: context.scope,
      runtimeSessionId: context.runtimeSessionId,
      ...(context.deadlineAt ? { deadlineAt: context.deadlineAt } : {}),
      signal: input.signal,
      publishActivity: input.publishActivity,
    }));
  }
}
