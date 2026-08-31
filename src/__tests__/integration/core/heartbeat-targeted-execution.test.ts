import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FileHeartbeatTaskService,
  HeartbeatRunnerAgent,
  HeartbeatSchedulerService,
  type AgentHeartbeatResult,
  type HeartbeatTask,
} from '../../../advanced.js';

const NOW = new Date('2026-08-08T06:00:00.000Z');
const stateRoots = new Set<string>();

describe('targeted heartbeat execution', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    stateRoots.forEach((root) => rmSync(root, { recursive: true, force: true }));
    stateRoots.clear();
  });

  it('runs only the addressed due task without scanning, recovering, or subscribing', async () => {
    const store = createStore('target-only');
    const taskA = createTask('task-a');
    const taskB = createTask('task-b');
    await Promise.all([store.saveTask(taskA), store.saveTask(taskB)]);
    const listTasks = vi.spyOn(store, 'listTasks');
    const recoverInterruptedTasks = vi.spyOn(store, 'recoverInterruptedTasks');
    const subscribeToRunRequests = vi.spyOn(store, 'subscribeToRunRequests');
    const handledTaskIds: string[] = [];

    const result = await HeartbeatSchedulerService.runTask({
      store,
      taskId: taskA.id,
      executionOwnerId: 'invocation-a',
      now: () => NOW,
      handler: async (context) => {
        handledTaskIds.push(context.task.id);
        return context.skip({ summary: 'No work for task A.' });
      },
    });

    expect(result).toMatchObject({ status: 'settled', taskId: taskA.id, failed: false });
    expect(handledTaskIds).toEqual([taskA.id]);
    expect(listTasks).not.toHaveBeenCalled();
    expect(recoverInterruptedTasks).not.toHaveBeenCalled();
    expect(subscribeToRunRequests).not.toHaveBeenCalled();
    await expect(store.loadTask(taskB.id)).resolves.toMatchObject({
      state: { status: 'idle' },
    });
  });

  it('returns busy to a duplicate delivery while one targeted invocation owns the claim', async () => {
    const root = createStateRoot('duplicate');
    const firstStore = new FileHeartbeatTaskService({ dir: root });
    const secondStore = new FileHeartbeatTaskService({ dir: root });
    const task = createTask('duplicate-task');
    await firstStore.saveTask(task);
    const handlerStarted = deferred<void>();
    const releaseHandler = deferred<void>();
    let invocations = 0;

    const first = HeartbeatSchedulerService.runTask({
      store: firstStore,
      taskId: task.id,
      executionOwnerId: 'invocation-first',
      now: () => NOW,
      handler: async (context) => {
        invocations++;
        handlerStarted.resolve();
        await releaseHandler.promise;
        return context.skip({ summary: 'First invocation settled.' });
      },
    });
    await handlerStarted.promise;

    const duplicate = await HeartbeatSchedulerService.runTask({
      store: secondStore,
      taskId: task.id,
      executionOwnerId: 'invocation-duplicate',
      now: () => NOW,
      handler: async (context) => {
        invocations++;
        return context.skip({ summary: 'Duplicate invocation must not run.' });
      },
    });
    expect(duplicate).toEqual({ status: 'busy', taskId: task.id, failed: false });
    expect(invocations).toBe(1);

    releaseHandler.resolve();
    await expect(first).resolves.toMatchObject({ status: 'settled', taskId: task.id, failed: false });
    expect(invocations).toBe(1);
  });

  it('does not rerun a settled request delivery after its due generation is consumed', async () => {
    const store = createStore('duplicate-after-settlement');
    const task = createTask('request-task');
    await store.saveTask(task);
    let invocations = 0;

    const first = await HeartbeatSchedulerService.runTask({
      store,
      taskId: task.id,
      executionOwnerId: 'invocation-first',
      now: () => NOW,
      handler: async (context) => {
        invocations++;
        return context.skip({ summary: 'Settled once.' });
      },
    });
    const duplicate = await HeartbeatSchedulerService.runTask({
      store,
      taskId: task.id,
      executionOwnerId: 'invocation-duplicate',
      now: () => NOW,
      handler: async (context) => {
        invocations++;
        return context.skip({ summary: 'This must not run.' });
      },
    });

    expect(first).toMatchObject({ status: 'settled', taskId: task.id });
    expect(duplicate).toMatchObject({
      status: 'not-due',
      taskId: task.id,
      nextRunAt: '2026-08-08T06:01:00.000Z',
      failed: false,
    });
    expect(invocations).toBe(1);
  });

  it('classifies missing, disabled, not-due, and pre-claim cancellation without invoking the handler', async () => {
    const store = createStore('preflight');
    const disabled = { ...createTask('disabled-task'), enabled: false };
    const future = createTask('future-task', '2026-08-08T07:00:00.000Z');
    const cancelled = createTask('cancelled-task');
    await Promise.all([store.saveTask(disabled), store.saveTask(future), store.saveTask(cancelled)]);
    const abortController = new AbortController();
    abortController.abort('dispatcher cancelled before delivery');
    const handler = vi.fn(async (context) => context.skip({ summary: 'Unexpected handler invocation.' }));

    await expect(HeartbeatSchedulerService.runTask({
      store,
      taskId: 'missing-task',
      executionOwnerId: 'missing',
      now: () => NOW,
      handler,
    })).resolves.toEqual({ status: 'not-found', taskId: 'missing-task', failed: false });
    await expect(HeartbeatSchedulerService.runTask({
      store,
      taskId: disabled.id,
      executionOwnerId: 'disabled',
      now: () => NOW,
      handler,
    })).resolves.toEqual({ status: 'disabled', taskId: disabled.id, failed: false });
    await expect(HeartbeatSchedulerService.runTask({
      store,
      taskId: future.id,
      executionOwnerId: 'future',
      now: () => NOW,
      handler,
    })).resolves.toMatchObject({ status: 'not-due', taskId: future.id, nextRunAt: future.schedule.nextRunAt, failed: false });
    await expect(HeartbeatSchedulerService.runTask({
      store,
      taskId: cancelled.id,
      executionOwnerId: 'cancelled',
      signal: abortController.signal,
      now: () => NOW,
      handler,
    })).resolves.toEqual({ status: 'cancelled', taskId: cancelled.id, failed: false });
    expect(handler).not.toHaveBeenCalled();
  });

  it('returns the durable blocking admission target without invoking the handler', async () => {
    const store = createStore('admission-closed');
    const task = { ...createTask('grouped-task'), admissionGroupId: 'publisher-a' };
    await store.saveTask(task);
    const handler = vi.fn(async (context) => context.skip({ summary: 'Unexpected handler invocation.' }));

    await expect(HeartbeatSchedulerService.runTask({
      store,
      taskId: task.id,
      executionOwnerId: 'missing-group',
      now: () => NOW,
      handler,
    })).resolves.toEqual({
      status: 'admission-closed',
      taskId: task.id,
      target: { kind: 'group', groupId: 'publisher-a' },
      failed: false,
    });

    await store.setAdmissionDecision({ kind: 'group', groupId: 'publisher-a' }, 'ready');
    await store.setAdmissionDecision({ kind: 'namespace' }, 'closed');
    await expect(HeartbeatSchedulerService.runTask({
      store,
      taskId: task.id,
      executionOwnerId: 'closed-namespace',
      now: () => NOW,
      handler,
    })).resolves.toEqual({
      status: 'admission-closed',
      taskId: task.id,
      target: { kind: 'namespace' },
      failed: false,
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it('returns normal failures and claim loss as distinct targeted outcomes', async () => {
    const failureStore = createStore('failure');
    const failureTask = createTask('failure-task');
    await failureStore.saveTask(failureTask);

    await expect(HeartbeatSchedulerService.runTask({
      store: failureStore,
      taskId: failureTask.id,
      executionOwnerId: 'failure-invocation',
      now: () => NOW,
      handler: async () => {
        throw new Error('expected handler failure');
      },
    })).resolves.toMatchObject({
      status: 'failed',
      taskId: failureTask.id,
      error: 'expected handler failure',
      failed: true,
    });

    const claimLossStore = createStore('claim-loss');
    const claimLossTask = createTask('claim-loss-task');
    await claimLossStore.saveTask(claimLossTask);
    vi.spyOn(claimLossStore, 'recordTaskExecutionOutcome').mockResolvedValueOnce({ status: 'claim-lost' });

    await expect(HeartbeatSchedulerService.runTask({
      store: claimLossStore,
      taskId: claimLossTask.id,
      executionOwnerId: 'claim-loss-invocation',
      now: () => NOW,
      handler: async (context) => context.skip({ summary: 'Settlement lost its claim.' }),
    })).resolves.toMatchObject({ status: 'claim-lost', taskId: claimLossTask.id, executionId: expect.any(String), failed: false });
  });

  it('returns an explicit custom-handler retry as a dispatcher-visible outcome', async () => {
    const store = createStore('retry');
    const task = createTask('retry-task');
    await store.saveTask(task);
    vi.spyOn(HeartbeatRunnerAgent, 'run').mockResolvedValue(createAgentResult('retry-agent-run'));

    const result = await HeartbeatSchedulerService.runTask({
      store,
      taskId: task.id,
      executionOwnerId: 'retry-invocation',
      now: () => NOW,
      handler: async (context) => {
        await context.runAgent();
        return context.retry({ summary: 'Host postcondition was not met.', delayMs: 90_000 });
      },
    });

    expect(result).toMatchObject({
      status: 'retry',
      taskId: task.id,
      failed: false,
      record: {
        outcome: {
          kind: 'retry',
          agentRunId: 'retry-agent-run',
          summary: 'Host postcondition was not met.',
        },
      },
    });
  });
});

function createStore(label: string): FileHeartbeatTaskService {
  return new FileHeartbeatTaskService({ dir: createStateRoot(label) });
}

function createStateRoot(label: string): string {
  const root = mkdtempSync(join(tmpdir(), `heddle-heartbeat-targeted-${label}-`));
  stateRoots.add(root);
  return root;
}

function createTask(id: string, nextRunAt = '2000-01-01T00:00:00.000Z'): HeartbeatTask {
  return {
    id,
    task: `Process ${id}.`,
    enabled: true,
    schedule: { intervalMs: 60_000, nextRunAt },
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

function createAgentResult(runId: string): AgentHeartbeatResult {
  const state: AgentHeartbeatResult['state'] = {
    status: 'finished',
    runId,
    goal: 'Targeted heartbeat test.',
    model: 'gpt-test',
    provider: 'openai',
    workspaceRoot: '/tmp/heartbeat-targeted-test',
    startedAt: '2026-08-08T06:00:00.000Z',
    finishedAt: '2026-08-08T06:00:01.000Z',
    outcome: 'done',
    summary: 'Agent run completed.',
    transcript: [],
    trace: [],
  };
  return {
    decision: 'continue',
    summary: state.summary,
    state,
    checkpoint: { version: 1, runId, createdAt: state.finishedAt, state },
  };
}
