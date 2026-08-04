import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FileHeartbeatTaskService,
  HeartbeatSchedulerService,
  type AgentHeartbeatResult,
  type HeartbeatSchedulerEvent,
  type HeartbeatTask,
} from '../../../advanced.js';
import { HeartbeatTaskRunnerService } from '@/core/heartbeat/index.js';
import { AgentLoopCheckpointService } from '@/core/runtime/loop/index.js';

const NOW = new Date('2026-08-04T00:00:00.000Z');

describe('heartbeat scheduler bounded concurrency', () => {
  it('runs at most two tasks concurrently in stable due order and returns records in that order', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'heddle-heartbeat-concurrency-'));
    const store = new FileHeartbeatTaskService({ dir });
    await saveTasks(store, [
      createTask('zeta', '2026-08-03T23:59:40.000Z'),
      createTask('bravo', '2026-08-03T23:59:00.000Z'),
      createTask('echo', '2026-08-03T23:59:30.000Z'),
      createTask('delta', '2026-08-03T23:59:00.000Z'),
      createTask('alpha', '2026-08-03T23:58:00.000Z'),
    ]);
    const selectedOrder = ['alpha', 'bravo', 'delta', 'echo', 'zeta'];
    const releases = new Map(selectedOrder.map((taskId) => [taskId, deferred<void>()]));
    const startGates = selectedOrder.map(() => deferred<void>());
    const startedTaskIds: string[] = [];
    const completionOrder: string[] = [];
    const events: HeartbeatSchedulerEvent[] = [];
    let active = 0;
    let maxActive = 0;

    const run = HeartbeatSchedulerService.runDueTasks({
      store,
      now: () => NOW,
      maxConcurrentTasks: 2,
      onEvent: (event) => events.push(event),
      runner: async (task) => {
        active++;
        maxActive = Math.max(maxActive, active);
        startedTaskIds.push(task.id);
        startGates[startedTaskIds.length - 1]?.resolve();
        await releases.get(task.id)?.promise;
        completionOrder.push(task.id);
        active--;
        return createHeartbeatResult(task.id);
      },
    });

    await startGates[1]?.promise;
    expect(startedTaskIds).toEqual(['alpha', 'bravo']);
    expect(maxActive).toBe(2);

    releases.get('bravo')?.resolve();
    await startGates[2]?.promise;
    expect(startedTaskIds).toEqual(['alpha', 'bravo', 'delta']);

    releases.get('delta')?.resolve();
    await startGates[3]?.promise;
    expect(startedTaskIds).toEqual(['alpha', 'bravo', 'delta', 'echo']);

    releases.get('echo')?.resolve();
    await startGates[4]?.promise;
    expect(startedTaskIds).toEqual(selectedOrder);

    releases.get('zeta')?.resolve();
    releases.get('alpha')?.resolve();
    const result = await run;

    expect(maxActive).toBe(2);
    expect(completionOrder).toEqual(['bravo', 'delta', 'echo', 'zeta', 'alpha']);
    expect(result).toMatchObject({ checked: 5, ran: 5, failed: 0 });
    expect(result.records.map((record) => record.task.id)).toEqual(selectedOrder);
    expect(events.filter((event) => event.type === 'heartbeat.task.due')).toMatchObject(
      selectedOrder.map((taskId, index) => ({
        type: 'heartbeat.task.due',
        taskId,
        queuePosition: index + 1,
        maxConcurrentTasks: 2,
      })),
    );
  });

  it.each([
    { label: 'by default', maxConcurrentTasks: undefined },
    { label: 'when explicitly set to one', maxConcurrentTasks: 1 },
  ])('preserves serial admission $label', async ({ maxConcurrentTasks }) => {
    const dir = mkdtempSync(join(tmpdir(), 'heddle-heartbeat-serial-'));
    const store = new FileHeartbeatTaskService({ dir });
    const taskIds = ['alpha', 'bravo', 'charlie'];
    await saveTasks(store, taskIds.map((taskId) => createTask(taskId, '2000-01-01T00:00:00.000Z')));
    const releases = new Map(taskIds.map((taskId) => [taskId, deferred<void>()]));
    const startGates = taskIds.map(() => deferred<void>());
    const startedTaskIds: string[] = [];
    let active = 0;
    let maxActive = 0;

    const run = HeartbeatSchedulerService.runDueTasks({
      store,
      now: () => NOW,
      maxConcurrentTasks,
      runner: async (task) => {
        active++;
        maxActive = Math.max(maxActive, active);
        startedTaskIds.push(task.id);
        startGates[startedTaskIds.length - 1]?.resolve();
        await releases.get(task.id)?.promise;
        active--;
        return createHeartbeatResult(task.id);
      },
    });

    await startGates[0]?.promise;
    expect(startedTaskIds).toEqual(['alpha']);
    releases.get('alpha')?.resolve();
    await startGates[1]?.promise;
    expect(startedTaskIds).toEqual(['alpha', 'bravo']);
    releases.get('bravo')?.resolve();
    await startGates[2]?.promise;
    releases.get('charlie')?.resolve();

    await expect(run).resolves.toMatchObject({ checked: 3, ran: 3, failed: 0 });
    expect(maxActive).toBe(1);
  });

  it('prevents overlapping scheduler and run-now attempts from executing one task twice', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'heddle-heartbeat-single-flight-'));
    const firstStore = new FileHeartbeatTaskService({ dir });
    const secondStore = new FileHeartbeatTaskService({ dir });
    await firstStore.saveTask(createTask('shared-task'));
    const firstStarted = deferred<void>();
    const releaseFirst = deferred<void>();
    let firstRunnerCalls = 0;
    let competingRunnerCalls = 0;

    const firstRun = HeartbeatSchedulerService.runDueTasks({
      store: firstStore,
      now: () => NOW,
      runner: async (task) => {
        firstRunnerCalls++;
        firstStarted.resolve();
        await releaseFirst.promise;
        return createHeartbeatResult(task.id);
      },
    });
    await firstStarted.promise;

    const competingRun = await HeartbeatTaskRunnerService.runTaskById({
      store: secondStore,
      taskId: 'shared-task',
      now: () => NOW,
      runner: async (task) => {
        competingRunnerCalls++;
        return createHeartbeatResult(task.id);
      },
    });
    expect(competingRun).toMatchObject({ checked: 1, ran: 0, failed: 0 });
    expect(competingRunnerCalls).toBe(0);

    releaseFirst.resolve();
    await expect(firstRun).resolves.toMatchObject({ checked: 1, ran: 1, failed: 0 });
    expect(firstRunnerCalls).toBe(1);
  });

  it('isolates one task failure and keeps deterministic aggregate counts and records', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'heddle-heartbeat-concurrency-failure-'));
    const store = new FileHeartbeatTaskService({ dir });
    await saveTasks(store, ['charlie', 'bravo', 'alpha'].map((taskId) => createTask(taskId)));

    const result = await HeartbeatSchedulerService.runDueTasks({
      store,
      now: () => NOW,
      maxConcurrentTasks: 2,
      runner: async (task) => {
        if (task.id === 'bravo') {
          throw new Error('bravo failed');
        }
        return createHeartbeatResult(task.id);
      },
    });

    expect(result).toMatchObject({ checked: 3, ran: 2, failed: 1 });
    expect(result.records.map((record) => record.task.id)).toEqual(['alpha', 'charlie']);
  });

  it('stops queued admissions, aborts active tasks, and waits for their final persistence', async () => {
    const stateRoot = mkdtempSync(join(tmpdir(), 'heddle-heartbeat-concurrency-stop-'));
    const store = new FileHeartbeatTaskService({ stateRoot });
    const taskIds = ['alpha', 'bravo', 'charlie', 'delta', 'echo'];
    await saveTasks(store, taskIds.map((taskId) => createTask(taskId, '2000-01-01T00:00:00.000Z')));
    const startGates = [deferred<void>(), deferred<void>()];
    const startedTaskIds: string[] = [];
    const observedAbortTaskIds: string[] = [];
    const events: HeartbeatSchedulerEvent[] = [];

    const scheduler = HeartbeatSchedulerService.start({
      workspaceRoot: stateRoot,
      stateRoot,
      pollIntervalMs: 60_000,
      maxConcurrentTasks: 2,
      handler: async (context) => {
        startedTaskIds.push(context.task.id);
        startGates[startedTaskIds.length - 1]?.resolve();
        await waitForAbort(context.signal);
        observedAbortTaskIds.push(context.task.id);
        return context.skip({ summary: 'Stopped by scheduler host.' });
      },
      onEvent: (event) => events.push(event),
    });

    await startGates[1]?.promise;
    await scheduler.stop({ cancelRunning: true });

    expect(startedTaskIds).toEqual(['alpha', 'bravo']);
    expect(observedAbortTaskIds).toEqual(['alpha', 'bravo']);
    expect(events.filter((event) => event.type === 'heartbeat.task.cancelled')).toHaveLength(2);
    expect(events.at(-1)).toMatchObject({
      type: 'heartbeat.scheduler.stopped',
      reason: 'aborted',
    });
    await expect(store.listRunRecords()).resolves.toHaveLength(2);
    await expect(store.listTasks()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'charlie', state: expect.objectContaining({ status: 'waiting' }) }),
      expect.objectContaining({ id: 'delta', state: expect.objectContaining({ status: 'waiting' }) }),
      expect.objectContaining({ id: 'echo', state: expect.objectContaining({ status: 'waiting' }) }),
    ]));
  });

  it.each([0, -1, 1.5])('rejects invalid maxConcurrentTasks value %s before touching the store', async (maxConcurrentTasks) => {
    let listCalls = 0;
    const store = new FileHeartbeatTaskService({
      dir: mkdtempSync(join(tmpdir(), 'heddle-heartbeat-invalid-concurrency-')),
    });
    const originalListTasks = store.listTasks.bind(store);
    store.listTasks = async () => {
      listCalls++;
      return await originalListTasks();
    };

    await expect(HeartbeatSchedulerService.runDueTasks({
      store,
      maxConcurrentTasks,
    })).rejects.toThrow(/maxConcurrentTasks.*positive integer/i);
    expect(listCalls).toBe(0);
    expect(() => HeartbeatSchedulerService.start({
      workspaceRoot: '/tmp/heddle-invalid-concurrency',
      stateRoot: '/tmp/heddle-invalid-concurrency/.heddle',
      maxConcurrentTasks,
    })).toThrow(/maxConcurrentTasks.*positive integer/i);
  });
});

async function saveTasks(store: FileHeartbeatTaskService, tasks: HeartbeatTask[]): Promise<void> {
  await Promise.all(tasks.map(async (task) => await store.saveTask(task)));
}

function createTask(id: string, nextRunAt = '2026-08-03T23:59:00.000Z'): HeartbeatTask {
  return {
    id,
    task: `Run ${id}.`,
    enabled: true,
    schedule: {
      intervalMs: 60_000,
      nextRunAt,
    },
    state: {
      status: 'waiting',
      resumable: true,
    },
  };
}

function createHeartbeatResult(taskId: string): AgentHeartbeatResult {
  const summary = `Finished ${taskId}.\n\nHEARTBEAT_DECISION: continue`;
  const state = {
    status: 'finished' as const,
    runId: `run-${taskId}`,
    goal: `Run ${taskId}.`,
    model: 'gpt-test',
    provider: 'openai' as const,
    workspaceRoot: '/tmp/project',
    startedAt: NOW.toISOString(),
    finishedAt: NOW.toISOString(),
    outcome: 'done' as const,
    summary,
    transcript: [],
    trace: [],
  };

  return {
    decision: 'continue',
    summary,
    state,
    checkpoint: AgentLoopCheckpointService.createCheckpoint(state, {
      createdAt: NOW.toISOString(),
    }),
  };
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve();
  }

  return new Promise((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}
