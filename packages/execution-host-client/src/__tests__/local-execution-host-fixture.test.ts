import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DirectHttpExecutionHost,
  ExecutionHostInvocationCancelledError,
  ExecutionHostRejectedError,
  ExecutionHostStreamInterruptedError,
  type ExecutionHostConversationTurn,
} from '../http-sse/index.js';
import { LocalExecutionHostContractFixture } from '../testing/index.js';
import type { ExecutionHostStreamEvent } from '../contracts/index.js';

const fixtures = new Set<LocalExecutionHostContractFixture>();
const TIMESTAMP = new Date('2026-08-10T12:00:00.000Z');

afterEach(async () => {
  await Promise.all([...fixtures].map((fixture) => fixture.close()));
  fixtures.clear();
});

describe('local Execution Host contract fixture', () => {
  it('runs an adopter callback through the real request and SSE clients', async () => {
    const execute = vi.fn(async (invocation) => {
      expect(invocation.request).toEqual({
        schemaVersion: 1,
        kind: 'conversation-turn',
        invocationId: 'invocation-001',
        prompt: 'Read product state through MCP.',
      });
      expect(invocation.runtimeSessionId).toBe(runtimeSessionId());
      expect(invocation.mcpCapability()).toBe(mcpCapability());
      expect(JSON.parse(JSON.stringify(invocation))).toEqual({
        schemaVersion: 1,
        kind: 'conversation-turn',
        invocationId: 'invocation-001',
        runtimeSessionId: runtimeSessionId(),
      });
      expect(JSON.stringify(invocation)).not.toContain('product state');
      expect(JSON.stringify(invocation)).not.toContain(mcpCapability());
      await invocation.publishActivity({
        type: 'product_mcp_call_completed',
      });
      return {
        kind: 'result' as const,
        result: { outcome: 'done' as const, summary: 'complete' },
      };
    });
    const fixture = await startFixture(execute);

    const events = await collect(
      fixture.createExecutionHost().streamConversationTurn(input()),
    );

    expect(execute).toHaveBeenCalledOnce();
    expect(events.map((event) => event.kind)).toEqual([
      'accepted',
      'activity',
      'result',
    ]);
    expect(events.map((event) => event.sequence)).toEqual([0, 1, 2]);
    expect(new Set(events.map((event) => event.runId))).toEqual(
      new Set(['run-001']),
    );
  });

  it('streams accepted before the adopter callback settles', async () => {
    let settle!: () => void;
    const fixture = await startFixture(async () => {
      await new Promise<void>((resolve) => { settle = resolve; });
      return { kind: 'result', result: { outcome: 'done' } };
    });
    const iterator = fixture.createExecutionHost()
      .streamConversationTurn(input())[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: { kind: 'accepted', sequence: 0 },
    });
    settle();
    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: { kind: 'result', sequence: 1 },
    });
  });

  it('supports an intentional ambiguous EOF recovery case', async () => {
    const fixture = await startFixture(async (invocation) => {
      await invocation.publishActivity({ type: 'checkpointed' });
      return { kind: 'interrupted' };
    });
    const observed: ExecutionHostStreamEvent[] = [];

    await expect(async () => {
      for await (const event of fixture.createExecutionHost()
        .streamConversationTurn(input())) {
        observed.push(event);
      }
    }).rejects.toBeInstanceOf(ExecutionHostStreamInterruptedError);
    expect(observed.map((event) => event.kind)).toEqual([
      'accepted',
      'activity',
    ]);
  });

  it('supports an invocation without product MCP authority', async () => {
    const fixture = await startFixture((invocation) => {
      expect(invocation.mcpCapability()).toBeUndefined();
      return { kind: 'result', result: { outcome: 'done' } };
    });

    const events = await collect(
      fixture.createExecutionHost().streamConversationTurn(input({
        mcpCapability: undefined,
      })),
    );

    expect(events.map((event) => event.kind)).toEqual(['accepted', 'result']);
  });

  it('sanitizes executor failures instead of reflecting their messages', async () => {
    const secret = 'secret-from-product-mcp';
    const fixture = await startFixture(() => {
      throw new Error(secret);
    });

    const events = await collect(
      fixture.createExecutionHost().streamConversationTurn(input()),
    );

    expect(events.at(-1)).toMatchObject({
      kind: 'error',
      error: {
        code: 'fixture_execution_failed',
        message: 'Local fixture execution failed.',
      },
    });
    expect(JSON.stringify(events)).not.toContain(secret);
  });

  it('rejects a client which does not possess the hidden local token', async () => {
    const execute = vi.fn();
    const fixture = await startFixture(execute);
    const unpairedClient = new DirectHttpExecutionHost({
      baseUrl: fixture.baseUrl(),
      localToken: 'incorrect-local-token',
    });

    await expect(collect(unpairedClient.streamConversationTurn(input())))
      .rejects.toEqual(new ExecutionHostRejectedError(
        401,
        'invalid_local_token',
      ));
    expect(execute).not.toHaveBeenCalled();
    expect(JSON.stringify(fixture)).toBe('{}');
  });

  it('propagates caller cancellation into the adopter callback', async () => {
    let callbackAborted = false;
    const entered = deferred();
    const fixture = await startFixture(async (invocation) => {
      entered.resolve();
      await new Promise<void>((resolve) => {
        invocation.signal.addEventListener('abort', () => {
          callbackAborted = true;
          resolve();
        }, { once: true });
      });
      return { kind: 'interrupted' };
    });
    const controller = new AbortController();
    const running = collect(fixture.createExecutionHost().streamConversationTurn(
      input({ signal: controller.signal }),
    ));
    await entered.promise;

    controller.abort();

    await expect(running).rejects.toBeInstanceOf(
      ExecutionHostInvocationCancelledError,
    );
    await vi.waitFor(() => expect(callbackAborted).toBe(true));
  });

  it('aborts active callbacks when the fixture closes', async () => {
    const entered = deferred();
    let callbackAborted = false;
    const fixture = await startFixture(async (invocation) => {
      entered.resolve();
      await new Promise<void>((resolve) => {
        invocation.signal.addEventListener('abort', () => {
          callbackAborted = true;
          resolve();
        }, { once: true });
      });
      return { kind: 'interrupted' };
    });
    const running = collect(
      fixture.createExecutionHost().streamConversationTurn(input()),
    );
    await entered.promise;

    await fixture.close();

    await expect(running).rejects.toBeInstanceOf(
      ExecutionHostStreamInterruptedError,
    );
    expect(callbackAborted).toBe(true);
  });

  it('validates explicit cancelled and error terminals', async () => {
    const cancelled = await startFixture(() => ({
      kind: 'cancelled',
      reason: 'product_cancelled',
    }));
    const cancelledEvents = await collect(
      cancelled.createExecutionHost().streamConversationTurn(input()),
    );
    expect(cancelledEvents.at(-1)).toMatchObject({
      kind: 'cancelled',
      reason: 'product_cancelled',
    });

    const rejected = await startFixture(() => ({
      kind: 'error',
      error: { code: 'product_unavailable', message: 'Try later.' },
    }));
    const errorEvents = await collect(
      rejected.createExecutionHost().streamConversationTurn(input()),
    );
    expect(errorEvents.at(-1)).toMatchObject({
      kind: 'error',
      error: { code: 'product_unavailable', message: 'Try later.' },
    });
  });
});

async function startFixture(
  execute: Parameters<
    typeof LocalExecutionHostContractFixture.start
  >[0]['execute'],
): Promise<LocalExecutionHostContractFixture> {
  const fixture = await LocalExecutionHostContractFixture.start({
    execute,
    now: () => new Date(TIMESTAMP),
    createRunId: () => 'run-001',
  });
  fixtures.add(fixture);
  return fixture;
}

function input(
  overrides: Partial<ExecutionHostConversationTurn> = {},
): ExecutionHostConversationTurn {
  return {
    invocationId: 'invocation-001',
    runtimeSessionId: runtimeSessionId(),
    prompt: 'Read product state through MCP.',
    executionAssertion: executionAssertion(),
    mcpCapability: mcpCapability(),
    modelApiKey: 'model-api-key',
    ...overrides,
  };
}

function executionAssertion(): string {
  return 'execution-assertion'.padEnd(32, 'x');
}

function mcpCapability(): string {
  return 'mcp-capability'.padEnd(32, 'x');
}

function runtimeSessionId(): string {
  return 'runtime-session-'.padEnd(33, 's');
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

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
