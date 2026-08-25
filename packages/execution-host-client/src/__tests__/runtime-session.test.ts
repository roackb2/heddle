import { describe, expect, it, vi } from 'vitest';
import type {
  ExecutionHostConversationTurnRequest,
  ExecutionHostHeartbeatTaskRequest,
  RuntimePublicResult,
} from '../contracts/index.js';
import {
  RuntimeBusyError,
  RuntimeDuplicateInvocationError,
  RuntimeScopeMismatchError,
  RuntimeSessionService,
  type RuntimeExecutionHandle,
  type RuntimeExecutionInput,
  type RuntimeWorkflowExecutor,
} from '../host/index.js';
import type { VerifiedExecutionIdentity } from '../host/types.js';

const NOW = new Date('2026-08-25T12:00:00.000Z');

describe('RuntimeSessionService', () => {
  it('binds one scope and delegates an invocation to the matching workflow', async () => {
    const executor = new TestConversationExecutor();
    const service = createService(executor);
    const handle = await service.start(startInput());

    expect(service.readStatus().state).toBe('executing');
    expect(executor.input).toMatchObject({
      executionSessionId: expect.stringMatching(/^runtime-[a-f0-9]{64}$/),
      request: { kind: 'conversation-turn', prompt: 'Inspect the workspace.' },
      modelApiKey: 'model-api-key',
    });

    executor.resolve({ outcome: 'done' });
    await expect(handle.result).resolves.toEqual({ outcome: 'done' });
    expect(service.readStatus().state).toBe('idle');
  });

  it('rejects concurrent, cross-scope, and recently completed invocations', async () => {
    const executor = new TestConversationExecutor();
    const service = createService(executor);
    const first = await service.start(startInput());

    await expect(service.start(startInput('invocation-b'))).rejects
      .toBeInstanceOf(RuntimeBusyError);
    await expect(service.start({
      ...startInput('invocation-c'),
      identity: {
        ...identity('invocation-c'),
        scope: { ...identity('invocation-c').scope, tenantId: 'tenant-b' },
      },
    })).rejects.toBeInstanceOf(RuntimeScopeMismatchError);

    executor.resolve({ outcome: 'done' });
    await first.result;
    await expect(service.start(startInput())).rejects
      .toBeInstanceOf(RuntimeDuplicateInvocationError);
  });

  it('propagates caller cancellation to the active workflow', async () => {
    const executor = new TestConversationExecutor();
    const service = createService(executor);
    const caller = new AbortController();
    const handle = await service.start({
      ...startInput(),
      callerSignal: caller.signal,
    });

    caller.abort(new Error('Caller disconnected.'));
    expect(executor.cancel).toHaveBeenCalledOnce();

    executor.reject(new Error('Cancelled.'));
    await expect(handle.result).rejects.toThrow('Cancelled.');
    expect(service.readStatus().state).toBe('idle');
  });
});

class TestConversationExecutor implements RuntimeWorkflowExecutor<
  ExecutionHostConversationTurnRequest,
  RuntimePublicResult
> {
  input?: RuntimeExecutionInput<ExecutionHostConversationTurnRequest>;
  readonly cancel = vi.fn(() => true);
  private readonly result = deferred<RuntimePublicResult>();

  start(
    input: RuntimeExecutionInput<ExecutionHostConversationTurnRequest>,
  ): Promise<RuntimeExecutionHandle<RuntimePublicResult>> {
    this.input = input;
    return Promise.resolve({
      runId: 'run-a',
      result: this.result.promise,
      events: async function* () {},
      cancel: this.cancel,
    });
  }

  resolve(result: RuntimePublicResult): void {
    this.result.resolve(result);
  }

  reject(error: Error): void {
    this.result.reject(error);
  }
}

function createService(conversationTurn: TestConversationExecutor) {
  const heartbeatTask: RuntimeWorkflowExecutor<
    ExecutionHostHeartbeatTaskRequest,
    unknown
  > = {
    start: () => Promise.reject(new Error('Unexpected heartbeat invocation.')),
  };
  return new RuntimeSessionService({
    config: { maxInvocationMs: 15 * 60_000 },
    executors: { conversationTurn, heartbeatTask },
    now: () => NOW,
  });
}

function startInput(invocationId = 'invocation-a') {
  return {
    identity: identity(invocationId),
    invocation: {
      schemaVersion: 1 as const,
      kind: 'conversation-turn' as const,
      invocationId,
      prompt: 'Inspect the workspace.',
    },
    modelApiKey: 'model-api-key',
    callerSignal: new AbortController().signal,
  };
}

function identity(invocationId: string): VerifiedExecutionIdentity {
  return {
    scope: {
      adopterId: 'lucid',
      tenantId: 'tenant-a',
      subjectId: 'subject-a',
      productSessionId: 'conversation-a',
    },
    runtimeSessionId: 's'.repeat(33),
    invocationId,
    workflow: 'conversation-turn',
    issuedAt: '2026-08-25T11:59:00.000Z',
    expiresAt: '2026-08-25T12:05:00.000Z',
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
