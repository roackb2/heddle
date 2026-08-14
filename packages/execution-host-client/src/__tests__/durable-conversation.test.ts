import { describe, expect, it } from 'vitest';
import {
  DurableHostedConversationTurnService,
  type HostedConversationAcceptedTurn,
  type HostedConversationExpiredTurnReconciliation,
  type HostedConversationRequestedTurn,
  type HostedConversationTurnInput,
  type HostedConversationTurnLifecycleStore,
  type HostedConversationTurnRunner,
  type HostedConversationTurnSettlement,
} from '../conversation/index.js';
import type {
  ExecutionHostStreamEvent,
  ExecutionHostTerminalEvent,
} from '../contracts/index.js';
import {
  ExecutionHostInvocationCancelledError,
  ExecutionHostProtocolError,
  ExecutionHostRejectedError,
  ExecutionHostStreamInterruptedError,
} from '../http-sse/index.js';

const REQUESTED_AT = '2026-08-14T00:00:00.000Z';
const ACCEPTED_AT = '2026-08-14T00:00:01.000Z';
const SETTLED_AT = '2026-08-14T00:00:02.000Z';

describe('durable hosted conversation turn service', () => {
  it('persists requested, accepted, and terminal state before releasing events', async () => {
    const order: string[] = [];
    const store = new RecordingLifecycleStore(order);
    const turns: HostedConversationTurnRunner = {
      streamTurn: async function* () {
        order.push('runner started');
        yield accepted();
        order.push('runner resumed');
        yield result({ outcome: 'done', summary: 'Durable answer.' });
      },
    };
    const iterator = createService(turns, store).streamTurn(turnInput())[
      Symbol.asyncIterator
    ]();

    await expect(iterator.next()).resolves.toEqual({
      value: accepted(),
      done: false,
    });
    expect(order).toEqual([
      'store requested',
      'runner started',
      'store accepted',
    ]);

    await expect(iterator.next()).resolves.toEqual({
      value: result({ outcome: 'done', summary: 'Durable answer.' }),
      done: false,
    });
    expect(order).toEqual([
      'store requested',
      'runner started',
      'store accepted',
      'runner resumed',
      'store settled',
    ]);
    await expect(iterator.next()).resolves.toEqual({
      value: undefined,
      done: true,
    });
  });

  it.each([
    [
      'completed result',
      result({ outcome: 'done', summary: 'Complete.' }),
      { status: 'completed', summary: 'Complete.' },
    ],
    [
      'max-steps result',
      result({ outcome: 'max_steps', summary: 'Partial.' }),
      { status: 'max_steps', summary: 'Partial.' },
    ],
    [
      'model failure',
      result({
        outcome: 'error',
        failure: { source: 'model', code: 'rate_limit' },
      }),
      { status: 'failed', failureCode: 'model_rate_limit' },
    ],
    [
      'result interruption',
      result({ outcome: 'interrupted' }),
      { status: 'interrupted', failureCode: 'execution_interrupted' },
    ],
    [
      'explicit cancellation',
      cancelled(),
      { status: 'cancelled', failureCode: 'invocation_cancelled' },
    ],
    [
      'public execution error',
      terminalError('provider_token_ghp_secret', 'secret internal detail'),
      { status: 'failed', failureCode: 'execution_error' },
    ],
  ] as const)('projects %s into one safe lifecycle settlement', async (
    _label,
    terminal,
    expected,
  ) => {
    const store = new RecordingLifecycleStore();
    await collect(createService(streamOf(accepted(), terminal), store)
      .streamTurn(turnInput()));

    expect(store.settlements).toHaveLength(1);
    expect(store.settlements[0]).toMatchObject(expected);
    expect(JSON.stringify(store.settlements[0])).not.toContain('ghp_secret');
    expect(JSON.stringify(store.settlements[0])).not.toContain(
      'secret internal detail',
    );
  });

  it('applies one summary bound to both durable and live output', async () => {
    const store = new RecordingLifecycleStore();
    const events = await collect(createService(
      streamOf(
        accepted(),
        result({ outcome: 'done', summary: '123456789' }),
      ),
      store,
      { maxSummaryCharacters: 5 },
    ).streamTurn(turnInput()));

    expect(events[1]).toMatchObject({
      kind: 'result',
      result: { summary: '12345' },
    });
    expect(readSummary(store.settlements[0])).toBe('12345');
  });

  it.each([
    [new ExecutionHostStreamInterruptedError(), 'interrupted', 'stream_interrupted'],
    [new ExecutionHostInvocationCancelledError(), 'interrupted', 'invocation_aborted'],
    [new ExecutionHostProtocolError(), 'failed', 'host_protocol_error'],
    [new ExecutionHostRejectedError(503, 'secret_shaped_code'), 'failed', 'host_rejected'],
    [new Error('secret thrown detail'), 'failed', 'execution_failed'],
  ] as const)('settles a thrown %s without persisting raw errors', async (
    error,
    status,
    failureCode,
  ) => {
    const store = new RecordingLifecycleStore();
    const turns: HostedConversationTurnRunner = {
      streamTurn: async function* () {
        yield accepted();
        throw error;
      },
    };

    await expect(collect(createService(turns, store).streamTurn(turnInput())))
      .rejects.toBe(error);
    expect(store.settlements[0]).toMatchObject({ status, failureCode });
    expect(JSON.stringify(store.settlements[0])).not.toContain('secret');
  });

  it('settles a clean stream ending without terminal as interrupted', async () => {
    const store = new RecordingLifecycleStore();
    const events = await collect(createService(
      streamOf(accepted()),
      store,
    ).streamTurn(turnInput()));

    expect(events).toEqual([accepted()]);
    expect(store.settlements[0]).toMatchObject({
      status: 'interrupted',
      failureCode: 'stream_ended_without_terminal',
    });
  });

  it.each([
    ['an empty stream', streamOf()],
    [
      'a terminal before acceptance',
      streamOf(result({ outcome: 'done', summary: 'Must not escape.' })),
    ],
  ])('rejects %s as a pre-acceptance protocol failure', async (
    _label,
    turns,
  ) => {
    const store = new RecordingLifecycleStore();

    await expect(collect(createService(turns, store).streamTurn(turnInput())))
      .rejects.toBeInstanceOf(ExecutionHostProtocolError);
    expect(store.settlements[0]).toMatchObject({
      status: 'failed',
      failureCode: 'host_protocol_error',
    });
  });

  it('settles an iterator closed by its consumer without inventing cancellation', async () => {
    const store = new RecordingLifecycleStore();
    const iterator = createService(
      streamOf(accepted(), activity()),
      store,
    ).streamTurn(turnInput())[Symbol.asyncIterator]();

    await iterator.next();
    await iterator.return?.();

    expect(store.settlements[0]).toMatchObject({
      status: 'interrupted',
      failureCode: 'stream_ended_without_terminal',
    });
  });

  it.each(['accepted', 'settled'] as const)(
    'fails closed when the %s persistence write fails',
    async (phase) => {
      const store = new RecordingLifecycleStore();
      store.rejectPhase = phase;
      const iterator = createService(
        streamOf(
          accepted(),
          result({ outcome: 'done', summary: 'Must not escape.' }),
        ),
        store,
      ).streamTurn(turnInput())[Symbol.asyncIterator]();

      if (phase === 'settled') {
        await expect(iterator.next()).resolves.toMatchObject({
          value: { kind: 'accepted' },
          done: false,
        });
      }
      await expect(iterator.next()).rejects.toThrow(
        `store ${phase} failed`,
      );
      expect(store.settlements).toHaveLength(phase === 'settled' ? 1 : 0);
      expect(store.order.filter((item) => item === 'store settled'))
        .toHaveLength(phase === 'settled' ? 1 : 0);
    },
  );

  it('reconciles expired turns with a bounded scope and configured grace', async () => {
    const store = new RecordingLifecycleStore();
    const service = createService(streamOf(), store, {
      expiredTurnGraceMs: 45_000,
    });

    await service.interruptExpiredTurns(turnInput().scope);

    expect(store.reconciliations).toEqual([{
      scope: turnInput().scope,
      expiredBefore: '2026-08-13T23:59:15.000Z',
      settledAt: REQUESTED_AT,
    }]);
  });
});

class RecordingLifecycleStore
implements HostedConversationTurnLifecycleStore {
  readonly order: string[];
  readonly requested: HostedConversationRequestedTurn[] = [];
  readonly accepted: HostedConversationAcceptedTurn[] = [];
  readonly settlements: HostedConversationTurnSettlement[] = [];
  readonly reconciliations: HostedConversationExpiredTurnReconciliation[] = [];
  rejectPhase?: 'accepted' | 'settled';

  constructor(order: string[] = []) {
    this.order = order;
  }

  async createTurn(input: HostedConversationRequestedTurn): Promise<void> {
    this.order.push('store requested');
    this.requested.push(input);
  }

  async recordAccepted(input: HostedConversationAcceptedTurn): Promise<void> {
    this.order.push('store accepted');
    if (this.rejectPhase === 'accepted') {
      throw new Error('store accepted failed');
    }
    this.accepted.push(input);
  }

  async settleTurn(input: HostedConversationTurnSettlement): Promise<void> {
    this.order.push('store settled');
    this.settlements.push(input);
    if (this.rejectPhase === 'settled') {
      throw new Error('store settled failed');
    }
  }

  async interruptExpiredTurns(
    input: HostedConversationExpiredTurnReconciliation,
  ): Promise<void> {
    this.reconciliations.push(input);
  }
}

function createService(
  turns: HostedConversationTurnRunner,
  store: HostedConversationTurnLifecycleStore,
  config: {
    maxSummaryCharacters?: number;
    expiredTurnGraceMs?: number;
  } = {},
): DurableHostedConversationTurnService {
  return new DurableHostedConversationTurnService({
    turns,
    store,
    ...config,
  }, {
    now: () => new Date(REQUESTED_AT),
  });
}

function streamOf(
  ...events: ExecutionHostStreamEvent[]
): HostedConversationTurnRunner {
  return {
    streamTurn: async function* () {
      yield* events;
    },
  };
}

function turnInput(): HostedConversationTurnInput {
  return {
    scope: {
      tenantId: 'tenant-a',
      subjectId: 'user-a',
      productSessionId: 'conversation-a',
    },
    runtimeSessionId: 'runtime-session-001-abcdefghijklmnop',
    invocationId: 'invocation-001',
    prompt: 'Summarize my workspace.',
    deadlineAt: '2026-08-14T00:05:00.000Z',
  };
}

function accepted(): ExecutionHostStreamEvent {
  return envelope({ sequence: 0, kind: 'accepted' });
}

function activity(): ExecutionHostStreamEvent {
  return envelope({
    sequence: 1,
    kind: 'activity',
    activity: { type: 'assistant_text_delta', text: 'Working.' },
  });
}

function result(
  value: Extract<ExecutionHostTerminalEvent, { kind: 'result' }>['result'],
): ExecutionHostTerminalEvent {
  return envelope({ sequence: 1, kind: 'result', result: value });
}

function cancelled(): ExecutionHostTerminalEvent {
  return envelope({
    sequence: 1,
    kind: 'cancelled',
    reason: 'Cancelled by user',
  });
}

function terminalError(code: string, message: string): ExecutionHostTerminalEvent {
  return envelope({
    sequence: 1,
    kind: 'error',
    error: { code, message },
  });
}

function envelope<T extends object>(event: T): T & {
  schemaVersion: 1;
  invocationId: string;
  runId: string;
  timestamp: string;
} {
  return {
    schemaVersion: 1,
    invocationId: 'invocation-001',
    runId: 'run-001',
    timestamp: event && 'kind' in event && event.kind === 'accepted'
      ? ACCEPTED_AT
      : SETTLED_AT,
    ...event,
  };
}

async function collect(
  stream: AsyncIterable<ExecutionHostStreamEvent>,
): Promise<ExecutionHostStreamEvent[]> {
  const events: ExecutionHostStreamEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

function readSummary(
  settlement: HostedConversationTurnSettlement | undefined,
): string | undefined {
  return settlement && 'summary' in settlement
    ? settlement.summary
    : undefined;
}
