import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FileHeartbeatTaskService,
  HeartbeatTargetedTaskHost,
  HeartbeatTargetedTaskWorker,
  type HeartbeatTargetedTaskInvocation,
  type HeartbeatTask,
} from '../../../advanced.js';

describe('targeted heartbeat task host', () => {
  const roots: string[] = [];
  const hosts: HeartbeatTargetedTaskHost[] = [];

  afterEach(async () => {
    await Promise.all(hosts.map((host) => (
      host.stop({ cancelRunning: true })
    )));
    roots.splice(0).forEach((root) => {
      rmSync(root, { recursive: true, force: true });
    });
    vi.restoreAllMocks();
  });

  it('subscribes to run requests, recovers, and reports the durable cancellation id', async () => {
    const store = createStore();
    await store.createTask({
      id: 'managed-local',
      task: 'Run one targeted task.',
      intervalMs: 60_000,
      defer: true,
    });
    const recoverInterruptedTasks = vi.spyOn(store, 'recoverInterruptedTasks');
    const invocations: HeartbeatTargetedTaskInvocation[] = [];
    const host = new HeartbeatTargetedTaskHost({
      store,
      createTarget: () => ({
        invoke: vi.fn(async (invocation) => {
          invocations.push(invocation);
          await aborted(invocation.signal);
          return {
            taskId: invocation.taskId,
            status: 'cancelled',
            executionId: 'durable-execution-id',
            failed: false,
          };
        }),
      }),
      taskIdPrefix: 'managed-',
      pollIntervalMs: 60_000,
      maxConcurrentInvocations: 1,
      invocationTimeoutMs: 60_000,
      recoveryIntervalMs: 60_000,
    });
    hosts.push(host);
    host.start({
      handler: async (execution) => execution.skip({ summary: 'Unused.' }),
    });
    await vi.waitFor(() => expect(recoverInterruptedTasks).toHaveBeenCalled());

    await store.requestTaskRun('managed-local', { reason: 'test-notification' });
    await vi.waitFor(() => expect(invocations).toHaveLength(1));

    await expect(host.cancelTask('managed-local', {
      reason: 'Operator paused this task.',
    })).resolves.toMatchObject({
      taskId: 'managed-local',
      disposition: 'cancelled',
      executionId: 'durable-execution-id',
    });
    expect(invocations[0]?.signal.aborted).toBe(true);

    await store.saveTask(remoteRunningTask());
    await expect(host.cancelTask('remote-running', {
      reason: 'Operator paused this task.',
    })).resolves.toMatchObject({
      taskId: 'remote-running',
      disposition: 'not-owned',
    });
  });

  it('classifies a completion race without claiming cancellation won', async () => {
    const store = createStore();
    await store.createTask({
      id: 'managed-race',
      task: 'Complete while cancellation races.',
      intervalMs: 60_000,
      defer: true,
    });
    const entered = deferred<void>();
    const release = deferred<void>();
    const host = new HeartbeatTargetedTaskHost({
      store,
      createTarget: () => ({
        invoke: async ({ taskId }) => {
          entered.resolve();
          await release.promise;
          return {
            taskId,
            status: 'failed',
            executionId: 'completed-execution',
            error: 'Already settled.',
            task: (await store.loadTask(taskId))!,
            failed: true,
          };
        },
      }),
      pollIntervalMs: 60_000,
      maxConcurrentInvocations: 1,
      invocationTimeoutMs: 60_000,
      recoveryIntervalMs: 60_000,
    });
    hosts.push(host);
    host.start({
      handler: async (execution) => execution.skip({ summary: 'Unused.' }),
    });
    await store.requestTaskRun('managed-race', { reason: 'test-race' });
    await entered.promise;

    const cancellation = host.cancelTask('managed-race', {
      reason: 'Operator cancelled.',
    });
    release.resolve();

    await expect(cancellation).resolves.toMatchObject({
      taskId: 'managed-race',
      disposition: 'completion-won',
      executionId: 'completed-execution',
    });
  });

  it('runs only the routed task through the standard targeted worker', async () => {
    const now = new Date('2026-08-08T08:00:00.000Z');
    const store = createStore();
    const tasks = [createTask('worker-a'), createTask('worker-b')];
    await store.reconcileTasks({ namespace: 'worker-', desired: tasks });
    await Promise.all(tasks.map((task) => store.requestTaskRun(task.id, {
      requestedAt: now,
      reason: 'test-work-arrived',
    })));
    const listTasks = vi.spyOn(store, 'listTasks');
    const recoverInterruptedTasks = vi.spyOn(store, 'recoverInterruptedTasks');
    const handledTaskIds: string[] = [];
    const worker = new HeartbeatTargetedTaskWorker({
      store,
      now: () => now,
      handler: async (execution) => {
        handledTaskIds.push(execution.task.id);
        return execution.skip({ summary: 'Deterministic worker test.' });
      },
    });

    const result = await worker.invoke({
      taskId: 'worker-a',
      invocationId: 'invocation-a',
      runRequestGeneration: 1,
      signal: new AbortController().signal,
    });

    expect(result.status).toBe('settled');
    expect(handledTaskIds).toEqual(['worker-a']);
    expect(listTasks).not.toHaveBeenCalled();
    expect(recoverInterruptedTasks).not.toHaveBeenCalled();
    await expect(store.loadTask('worker-b')).resolves.toMatchObject({
      state: {
        runRequest: { generation: 1, claimedGeneration: 0 },
      },
    });
  });

  function createStore(): FileHeartbeatTaskService {
    const root = mkdtempSync(join(tmpdir(), 'heddle-targeted-host-'));
    roots.push(root);
    return new FileHeartbeatTaskService({ dir: root });
  }
});

function createTask(id: string): HeartbeatTask {
  return {
    id,
    task: `Process work for ${id}.`,
    enabled: true,
    schedule: {
      intervalMs: 60_000,
      nextRunAt: '2099-01-01T00:00:00.000Z',
    },
  };
}

function remoteRunningTask(): HeartbeatTask {
  return {
    id: 'remote-running',
    task: 'Owned by another targeted task host.',
    enabled: true,
    schedule: { intervalMs: 60_000 },
    state: {
      status: 'running',
      execution: {
        executionId: 'remote-execution',
        ownerId: 'remote-owner',
        claimedAt: '2026-08-08T08:00:00.000Z',
      },
    },
  };
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
