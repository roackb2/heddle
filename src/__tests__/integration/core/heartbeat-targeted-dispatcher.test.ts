import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HeartbeatTargetedTaskDispatcher,
  resolveHeartbeatTargetedTaskDispatchDecision,
  type HeartbeatTargetedTaskInvocation,
  type HeartbeatTargetedTaskInvocationTarget,
  type HeartbeatTask,
  type HeartbeatTaskRunRequestSignal,
  type RunHeartbeatTaskResult,
} from '../../../advanced.js';

describe('targeted heartbeat task dispatcher', () => {
  const dispatchers: HeartbeatTargetedTaskDispatcher[] = [];

  afterEach(async () => {
    await Promise.all(dispatchers.map((dispatcher) => dispatcher.stop()));
    dispatchers.length = 0;
    vi.restoreAllMocks();
  });

  it('coalesces duplicate generations without concurrent work for one task', async () => {
    const firstRun = deferred<void>();
    const invocations: HeartbeatTargetedTaskInvocation[] = [];
    const target: HeartbeatTargetedTaskInvocationTarget = {
      invoke: vi.fn(async (invocation) => {
        invocations.push(invocation);
        if (invocations.length === 1) {
          await firstRun.promise;
        }
        return noWork(invocation.taskId);
      }),
    };
    const dispatcher = createDispatcher({ target });
    dispatcher.start();

    expect(dispatcher.notify(runRequest('managed-a', 1)).status).toBe('queued');
    await vi.waitFor(() => expect(invocations).toHaveLength(1));
    expect(dispatcher.notify(runRequest('managed-a', 1)).status)
      .toBe('coalesced');
    expect(dispatcher.notify(runRequest('managed-a', 2)).status).toBe('queued');
    expect(invocations).toHaveLength(1);

    firstRun.resolve();
    await vi.waitFor(() => expect(invocations).toHaveLength(2));
    expect(invocations.map(({ runRequestGeneration }) => runRequestGeneration))
      .toEqual([1, 2]);
  });

  it('coalesces generation-free polling hints while a task is represented', async () => {
    const firstRun = deferred<void>();
    const target: HeartbeatTargetedTaskInvocationTarget = {
      invoke: vi.fn(async ({ taskId }) => {
        await firstRun.promise;
        return noWork(taskId);
      }),
    };
    const dispatcher = createDispatcher({ target });
    dispatcher.start();

    expect(dispatcher.notify({
      ...runRequest('managed-scheduled', 1),
      generation: undefined,
    }).status).toBe('queued');
    await vi.waitFor(() => expect(target.invoke).toHaveBeenCalledOnce());
    expect(dispatcher.notify({
      ...runRequest('managed-scheduled', 1),
      generation: undefined,
    }).status).toBe('coalesced');

    firstRun.resolve();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(target.invoke).toHaveBeenCalledOnce();
  });

  it('uses the durable admission gate and polling correctness fallback', async () => {
    let enabled = false;
    const task = createDueTask('managed-polled');
    const store = { listTasks: vi.fn(async () => [task]) };
    const target: HeartbeatTargetedTaskInvocationTarget = {
      invoke: vi.fn(async ({ taskId }) => {
        task.enabled = false;
        return noWork(taskId);
      }),
    };
    const dispatcher = createDispatcher({
      store,
      target,
      pollIntervalMs: 10,
      isAdmissionEnabled: async () => enabled,
    });
    dispatcher.start();
    dispatcher.notify(runRequest(task.id, 1));

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(store.listTasks).not.toHaveBeenCalled();
    expect(target.invoke).not.toHaveBeenCalled();

    enabled = true;
    await vi.waitFor(() => expect(target.invoke).toHaveBeenCalledOnce());
    expect(store.listTasks).toHaveBeenCalled();
  });

  it('bounds independent concurrency and rejects unmanaged notifications', async () => {
    const releases = new Map<string, Deferred<void>>();
    let active = 0;
    let maximumActive = 0;
    const target: HeartbeatTargetedTaskInvocationTarget = {
      invoke: vi.fn(async ({ taskId }) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        const release = deferred<void>();
        releases.set(taskId, release);
        await release.promise;
        active -= 1;
        return noWork(taskId);
      }),
    };
    const dispatcher = createDispatcher({
      target,
      maxConcurrentInvocations: 2,
    });
    dispatcher.start();
    expect(dispatcher.notify(runRequest('outside-a', 1)).status)
      .toBe('not-managed');
    ['a', 'b', 'c'].forEach((suffix) => {
      dispatcher.notify(runRequest(`managed-${suffix}`, 1));
    });

    await vi.waitFor(() => expect(target.invoke).toHaveBeenCalledTimes(2));
    expect(maximumActive).toBe(2);
    releases.get('managed-a')?.resolve();
    await vi.waitFor(() => expect(target.invoke).toHaveBeenCalledTimes(3));
    expect(maximumActive).toBe(2);
    releases.forEach((release) => release.resolve());
  });

  it('retries contention but respects Heddle durable schedules', async () => {
    const outcomes: RunHeartbeatTaskResult['status'][] = [];
    let attempts = 0;
    const target: HeartbeatTargetedTaskInvocationTarget = {
      invoke: vi.fn(async ({ taskId }) => {
        attempts += 1;
        return attempts === 1
          ? { taskId, status: 'busy', failed: false }
          : noWork(taskId);
      }),
    };
    const dispatcher = createDispatcher({
      target,
      contentionRetryMs: 10,
      onOutcome: ({ result }) => outcomes.push(result.status),
    });
    dispatcher.start();
    dispatcher.notify(runRequest('managed-contention', 1));

    await vi.waitFor(() => expect(target.invoke).toHaveBeenCalledTimes(2));
    expect(outcomes).toEqual(['busy', 'not-found']);
    expect(resolveHeartbeatTargetedTaskDispatchDecision('claim-lost', 25))
      .toEqual({ kind: 'retry-transiently', delayMs: 25 });
    for (const status of ['retry', 'failed', 'not-due', 'admission-closed', 'cancelled'] as const) {
      expect(resolveHeartbeatTargetedTaskDispatchDecision(status, 25))
        .toEqual({ kind: 'wait-for-durable-schedule' });
    }
    for (const status of ['settled', 'not-found', 'disabled'] as const) {
      expect(resolveHeartbeatTargetedTaskDispatchDecision(status, 25))
        .toEqual({ kind: 'complete-delivery' });
    }
  });

  it('retains paused notifications and cancels active work on demand', async () => {
    const invocations = new Map<string, HeartbeatTargetedTaskInvocation>();
    const target: HeartbeatTargetedTaskInvocationTarget = {
      invoke: vi.fn(async (invocation) => {
        invocations.set(invocation.taskId, invocation);
        await aborted(invocation.signal);
        return {
          taskId: invocation.taskId,
          status: 'cancelled',
          failed: false,
        };
      }),
    };
    const dispatcher = createDispatcher({ target });
    dispatcher.start({ admissionPaused: true });
    expect(dispatcher.notify(runRequest('managed-paused', 1)).status)
      .toBe('queued');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(target.invoke).not.toHaveBeenCalled();

    dispatcher.resume();
    await vi.waitFor(() => expect(target.invoke).toHaveBeenCalledOnce());
    const cancellation = await dispatcher.cancelTask(
      'managed-paused',
      'Operator paused this task.',
    );
    expect(cancellation).toMatchObject({
      taskId: 'managed-paused',
      disposition: 'cancelled',
    });
    expect(invocations.get('managed-paused')?.signal.aborted).toBe(true);
  });

  it('cancels invocations that exceed their wall-clock bound', async () => {
    const target: HeartbeatTargetedTaskInvocationTarget = {
      invoke: vi.fn(async (invocation) => {
        await aborted(invocation.signal);
        return {
          taskId: invocation.taskId,
          status: 'cancelled',
          failed: false,
        };
      }),
    };
    const dispatcher = createDispatcher({
      target,
      invocationTimeoutMs: 10,
    });
    dispatcher.start();
    dispatcher.notify(runRequest('managed-timeout', 1));

    await vi.waitFor(() => {
      const invocation = vi.mocked(target.invoke).mock.calls[0]?.[0];
      expect(invocation?.signal.aborted).toBe(true);
      expect(invocation?.signal.reason).toBeInstanceOf(Error);
    });
  });

  function createDispatcher(
    overrides: Partial<
      ConstructorParameters<typeof HeartbeatTargetedTaskDispatcher>[0]
    > = {},
  ): HeartbeatTargetedTaskDispatcher {
    const dispatcher = new HeartbeatTargetedTaskDispatcher({
      store: { listTasks: async () => [] },
      target: { invoke: async ({ taskId }) => noWork(taskId) },
      taskIdPrefix: 'managed-',
      pollIntervalMs: 1_000,
      maxConcurrentInvocations: 1,
      invocationTimeoutMs: 60_000,
      contentionRetryMs: 25,
      ...overrides,
    });
    dispatchers.push(dispatcher);
    return dispatcher;
  }
});

function runRequest(
  taskId: string,
  generation: number,
): HeartbeatTaskRunRequestSignal {
  return {
    taskId,
    generation,
    disposition: generation === 1 ? 'requested' : 'coalesced',
    requestedAt: '2026-08-08T08:00:00.000Z',
    reason: 'test-work-arrived',
  };
}

function createDueTask(id: string): HeartbeatTask {
  return {
    id,
    task: `Process work for ${id}.`,
    enabled: true,
    schedule: {
      intervalMs: 60_000,
      nextRunAt: '2000-01-01T00:00:00.000Z',
    },
    state: {
      status: 'waiting',
      runRequest: {
        generation: 1,
        claimedGeneration: 0,
        requestedAt: '2000-01-01T00:00:00.000Z',
      },
    },
  };
}

function noWork(taskId: string): RunHeartbeatTaskResult {
  return { taskId, status: 'not-found', failed: false };
}

type Deferred<T> = {
  promise: Promise<T>;
  resolve(value?: T | PromiseLike<T>): void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>['resolve'];
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

async function aborted(signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return;
  }
  await new Promise<void>((resolve) => {
    signal.addEventListener('abort', () => resolve(), { once: true });
  });
}
