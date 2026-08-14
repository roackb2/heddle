import dayjs from 'dayjs';
import { z } from 'zod';
import {
  isExecutionHostTerminalEvent,
  type ExecutionHostTerminalEvent,
} from '../contracts/index.js';
import {
  ExecutionHostInvocationCancelledError,
  ExecutionHostProtocolError,
  ExecutionHostRejectedError,
  ExecutionHostStreamInterruptedError,
} from '../http-sse/index.js';
import {
  HostedConversationAcceptedTurnSchema,
  HostedConversationExpiredTurnReconciliationSchema,
  HostedConversationRequestedTurnSchema,
  HostedConversationTurnSettlementSchema,
  type DurableHostedConversationTurnServiceConfig,
  type DurableHostedConversationTurnServiceOptions,
  type HostedConversationFailureCode,
  type HostedConversationPersistenceScope,
  type HostedConversationTerminalProjection,
  type HostedConversationTurnIdentity,
  type HostedConversationTurnLifecycleStore,
  type HostedConversationTurnReconciliationOptions,
} from './lifecycle-types.js';
import type {
  HostedConversationTurnRunner,
} from './types.js';
import { HostedConversationTurnInputSchema } from './types.js';

const DEFAULT_MAX_SUMMARY_CHARACTERS = 100_000;
const DEFAULT_EXPIRED_TURN_GRACE_MS = 60_000;
const LifecycleOptionsSchema = z.object({
  maxSummaryCharacters: z.number().int().positive().max(1_000_000),
  expiredTurnGraceMs: z.number().int().nonnegative().max(86_400_000),
}).strict();
const MODEL_FAILURE_CODE = {
  authentication: 'model_authentication',
  permission: 'model_permission',
  quota: 'model_quota',
  rate_limit: 'model_rate_limit',
  context_window: 'model_context_window',
  request: 'model_request',
  transport: 'model_transport',
  empty_response: 'model_empty_response',
  unknown: 'model_unknown',
} as const satisfies Record<string, HostedConversationFailureCode>;
type PersistenceState = 'open' | 'settling' | 'settled' | 'write_failed';

/**
 * Applies one reusable durable lifecycle around an Execution Host turn.
 *
 * Requested state is written before execution starts. Accepted and terminal
 * writes complete before their corresponding public events are released. A
 * persistence failure therefore fails closed instead of acknowledging state
 * that the adopter cannot later recover.
 */
export class DurableHostedConversationTurnService
implements HostedConversationTurnRunner {
  readonly #turns: HostedConversationTurnRunner;
  readonly #store: DurableHostedConversationTurnServiceConfig['store'];
  readonly #maxSummaryCharacters: number;
  readonly #expiredTurnGraceMs: number;
  readonly #now: () => Date;

  constructor(
    config: DurableHostedConversationTurnServiceConfig,
    options: DurableHostedConversationTurnServiceOptions = {},
  ) {
    const lifecycle = LifecycleOptionsSchema.parse({
      maxSummaryCharacters: config.maxSummaryCharacters
        ?? DEFAULT_MAX_SUMMARY_CHARACTERS,
      expiredTurnGraceMs: config.expiredTurnGraceMs
        ?? DEFAULT_EXPIRED_TURN_GRACE_MS,
    });
    this.#turns = config.turns;
    this.#store = config.store;
    this.#maxSummaryCharacters = lifecycle.maxSummaryCharacters;
    this.#expiredTurnGraceMs = lifecycle.expiredTurnGraceMs;
    this.#now = options.now ?? (() => new Date());
  }

  async *streamTurn(
    rawInput: Parameters<HostedConversationTurnRunner['streamTurn']>[0],
  ): ReturnType<HostedConversationTurnRunner['streamTurn']> {
    const input = HostedConversationTurnInputSchema.parse(rawInput);
    const scope = Object.freeze({ ...input.scope });
    const turn = { ...input, scope };
    const identity: HostedConversationTurnIdentity = {
      invocationId: turn.invocationId,
      scope,
    };
    await this.#store.createTurn(HostedConversationRequestedTurnSchema.parse({
      ...identity,
      prompt: turn.prompt,
      ...(turn.deadlineAt ? { deadlineAt: turn.deadlineAt } : {}),
      requestedAt: this.#now().toISOString(),
    }));

    let persistenceState: PersistenceState = 'open';
    let streamAccepted = false;
    const settle = async (
      settlement: HostedConversationTerminalProjection['settlement'] & {
        settledAt: string;
      },
    ): Promise<void> => {
      persistenceState = 'settling';
      await this.#store.settleTurn(HostedConversationTurnSettlementSchema.parse({
        ...identity,
        ...settlement,
      }));
      persistenceState = 'settled';
    };

    try {
      turn.signal?.throwIfAborted();
      for await (const event of this.#turns.streamTurn(turn)) {
        if (event.kind === 'accepted') {
          if (streamAccepted) {
            throw new ExecutionHostProtocolError(
              'Hosted turn emitted more than one accepted event.',
            );
          }
          try {
            await this.#store.recordAccepted(
              HostedConversationAcceptedTurnSchema.parse({
                ...identity,
                runId: event.runId,
                acceptedAt: event.timestamp,
              }),
            );
          } catch (error) {
            persistenceState = 'write_failed';
            throw error;
          }
          streamAccepted = true;
          yield event;
          continue;
        }
        if (!streamAccepted) {
          throw new ExecutionHostProtocolError(
            'Hosted turn emitted data before its accepted event.',
          );
        }
        if (isExecutionHostTerminalEvent(event)) {
          const projection = projectTerminalEvent(
            event,
            this.#maxSummaryCharacters,
          );
          await settle({
            ...projection.settlement,
            settledAt: event.timestamp,
          });
          yield projection.event;
          return;
        }
        yield event;
      }

      if (!streamAccepted) {
        throw new ExecutionHostProtocolError(
          'Hosted turn stream omitted its accepted event.',
        );
      }
      if (persistenceState === 'open') {
        await settle({
          status: 'interrupted',
          failureCode: 'stream_ended_without_terminal',
          settledAt: this.#now().toISOString(),
        });
      }
    } catch (error) {
      if (persistenceState === 'open') {
        await settle({
          ...projectThrownFailure(error, turn.signal),
          settledAt: this.#now().toISOString(),
        });
      }
      throw error;
    } finally {
      // Returning from a consumer closes an async generator without throwing.
      // Settle that still-open invocation before releasing the managed stream.
      if (persistenceState === 'open') {
        await settle({
          status: 'interrupted',
          failureCode: 'stream_ended_without_terminal',
          settledAt: this.#now().toISOString(),
        });
      }
    }
  }

  /** Reconciles only expired open turns within one already-authorized scope. */
  interruptExpiredTurns(
    scope: HostedConversationPersistenceScope,
  ): Promise<void> {
    return interruptExpiredHostedConversationTurns(this.#store, scope, {
      expiredTurnGraceMs: this.#expiredTurnGraceMs,
      now: this.#now,
    });
  }
}

export function interruptExpiredHostedConversationTurns(
  store: HostedConversationTurnLifecycleStore,
  scope: HostedConversationPersistenceScope,
  options: HostedConversationTurnReconciliationOptions = {},
): Promise<void> {
  const { expiredTurnGraceMs } = LifecycleOptionsSchema.pick({
    expiredTurnGraceMs: true,
  }).parse({
    expiredTurnGraceMs: options.expiredTurnGraceMs
      ?? DEFAULT_EXPIRED_TURN_GRACE_MS,
  });
  const now = (options.now ?? (() => new Date()))();
  return store.interruptExpiredTurns(
    HostedConversationExpiredTurnReconciliationSchema.parse({
      scope: Object.freeze({ ...scope }),
      expiredBefore: dayjs(now)
        .subtract(expiredTurnGraceMs, 'millisecond')
        .toISOString(),
      settledAt: now.toISOString(),
    }),
  );
}

export function projectHostedConversationTerminalEvent(
  event: ExecutionHostTerminalEvent,
  options: { maxSummaryCharacters?: number } = {},
): HostedConversationTerminalProjection {
  const { maxSummaryCharacters } = LifecycleOptionsSchema.pick({
    maxSummaryCharacters: true,
  }).parse({
    maxSummaryCharacters: options.maxSummaryCharacters
      ?? DEFAULT_MAX_SUMMARY_CHARACTERS,
  });
  return projectTerminalEvent(event, maxSummaryCharacters);
}

function projectTerminalEvent(
  event: ExecutionHostTerminalEvent,
  maxSummaryCharacters: number,
): HostedConversationTerminalProjection {
  if (event.kind === 'cancelled') {
    return {
      event,
      settlement: {
        status: 'cancelled',
        failureCode: 'invocation_cancelled',
      },
    };
  }
  if (event.kind === 'error') {
    return {
      event,
      settlement: {
        status: 'failed',
        failureCode: 'execution_error',
      },
    };
  }

  const summary = event.result.summary === undefined
    ? undefined
    : takeUnicodeCodePoints(event.result.summary, maxSummaryCharacters);
  const projectedEvent = summary === event.result.summary
    ? event
    : {
        ...event,
        result: {
          ...event.result,
          summary,
        },
      };
  if (event.result.outcome === 'done') {
    return {
      event: projectedEvent,
      settlement: {
        status: 'completed',
        ...(summary !== undefined ? { summary } : {}),
      },
    };
  }
  if (event.result.outcome === 'max_steps') {
    return {
      event: projectedEvent,
      settlement: {
        status: 'max_steps',
        ...(summary !== undefined ? { summary } : {}),
      },
    };
  }
  if (event.result.outcome === 'interrupted') {
    return {
      event: projectedEvent,
      settlement: {
        status: 'interrupted',
        ...(summary !== undefined ? { summary } : {}),
        failureCode: 'execution_interrupted',
      },
    };
  }
  return {
    event: projectedEvent,
    settlement: {
      status: 'failed',
      ...(summary !== undefined ? { summary } : {}),
      failureCode: event.result.failure
        ? MODEL_FAILURE_CODE[event.result.failure.code]
        : 'execution_result_error',
    },
  };
}

function takeUnicodeCodePoints(value: string, maximum: number): string {
  let codePoints = 0;
  let utf16End = 0;
  for (const codePoint of value) {
    codePoints += 1;
    if (codePoints > maximum) {
      return value.slice(0, utf16End);
    }
    utf16End += codePoint.length;
  }
  return value;
}

function projectThrownFailure(
  error: unknown,
  signal?: AbortSignal,
): Extract<
  HostedConversationTerminalProjection['settlement'],
  { status: 'failed' | 'interrupted' }
> {
  if (error instanceof ExecutionHostStreamInterruptedError) {
    return { status: 'interrupted', failureCode: 'stream_interrupted' };
  }
  if (signal?.aborted || error instanceof ExecutionHostInvocationCancelledError) {
    return { status: 'interrupted', failureCode: 'invocation_aborted' };
  }
  if (error instanceof ExecutionHostProtocolError) {
    return { status: 'failed', failureCode: 'host_protocol_error' };
  }
  if (error instanceof ExecutionHostRejectedError) {
    return { status: 'failed', failureCode: 'host_rejected' };
  }
  return { status: 'failed', failureCode: 'execution_failed' };
}
