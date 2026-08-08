import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FileHeartbeatTaskService,
  HeartbeatSchedulerService,
  type HeartbeatTask,
} from '../../../advanced.js';
import { AgentLoopCheckpointService } from '@/core/runtime/loop/index.js';

const NOW = new Date('2026-08-08T00:00:00.000Z');

describe('file-backed heartbeat task concurrency', () => {
  it('keeps concurrent distinct creates valid and listable', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'heddle-heartbeat-file-create-'));
    const store = new FileHeartbeatTaskService({ dir });
    const taskIds = ['host-alpha', 'host-bravo', 'host-charlie', 'host-delta'];

    await Promise.all(taskIds.map(async (id) => await store.createTask({
      id,
      task: `Run ${id}.`,
    })));

    await expect(store.listTasks()).resolves.toEqual(expect.arrayContaining(
      taskIds.map((id) => expect.objectContaining({ id })),
    ));
    expectValidTaskFiles(dir);
  });

  it('serializes overlapping supported mutations and readers without losing unrelated tasks', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'heddle-heartbeat-file-stress-'));
    const firstStore = new FileHeartbeatTaskService({ dir });
    const secondStore = new FileHeartbeatTaskService({ dir });
    await firstStore.createTask({ id: 'mutable', task: 'Toggle this task.' });
    await firstStore.createTask({ id: 'requestable', task: 'Request this task.' });
    const createdTaskIds = ['created-0', 'created-1', 'created-2', 'created-3'];
    const savedTaskIds = ['saved-0', 'saved-1', 'saved-2', 'saved-3'];

    await Promise.all([
      ...createdTaskIds.map(async (id) => await firstStore.createTask({ id, task: `Create ${id}.` })),
      ...savedTaskIds.map(async (id) => await secondStore.saveTask(createTask(id))),
      ...Array.from({ length: 12 }, async (_, index) => await firstStore.setTaskEnabled('mutable', index % 2 === 0)),
      ...Array.from({ length: 12 }, async (_, index) => await secondStore.requestTaskRun('requestable', {
        reason: `request-${index}`,
        requestedAt: new Date(NOW.getTime() + index),
      })),
      ...Array.from({ length: 24 }, async () => await firstStore.listTasks()),
    ]);

    const listedIds = new Set((await secondStore.listTasks()).map((task) => task.id));
    [...createdTaskIds, ...savedTaskIds, 'mutable', 'requestable'].forEach((id) => {
      expect(listedIds.has(id)).toBe(true);
    });
    await expect(secondStore.requireTask('requestable')).resolves.toMatchObject({
      state: {
        runRequest: {
          generation: 12,
          claimedGeneration: 0,
        },
      },
    });
    expectValidTaskFiles(dir);
  });

  it('rejects one of two same-ID creates without replacing the winning task', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'heddle-heartbeat-file-conflict-'));
    const firstStore = new FileHeartbeatTaskService({ dir });
    const secondStore = new FileHeartbeatTaskService({ dir });

    const results = await Promise.allSettled([
      firstStore.createTask({ id: 'same-id', task: 'First task.' }),
      secondStore.createTask({ id: 'same-id', task: 'Second task.' }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    await expect(firstStore.listTasks()).resolves.toEqual([
      expect.objectContaining({ id: 'same-id', task: expect.stringMatching(/task\.$/) }),
    ]);
    await expect(secondStore.createTask({ id: 'same-id', task: 'Third task.' })).rejects.toThrow(/already exists/i);
  });

  it('reconciles one namespace without deleting or rewriting a running claimed task', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'heddle-heartbeat-file-reconcile-'));
    const store = new FileHeartbeatTaskService({ dir });
    const liveTask = {
      ...createTask('representative-live'),
      task: 'Keep this claimed task intact.',
      state: {
        status: 'running' as const,
        execution: {
          executionId: 'live-execution',
          ownerId: 'live-worker',
          claimedAt: NOW.toISOString(),
        },
        runRequest: {
          generation: 3,
          claimedGeneration: 3,
          requestedAt: NOW.toISOString(),
        },
      },
    };
    const checkpoint = AgentLoopCheckpointService.createCheckpoint({
      status: 'running',
      runId: 'live-run',
      goal: 'Keep the claim.',
      model: 'gpt-test',
      provider: 'openai',
      workspaceRoot: '/tmp/heartbeat-reconcile',
      startedAt: NOW.toISOString(),
      transcript: [],
      trace: [],
    }, { createdAt: NOW.toISOString() });
    await store.saveTask(liveTask);
    await store.saveCheckpoint(liveTask, checkpoint);
    await store.saveTask(createTask('representative-obsolete'));
    await store.saveTask(createTask('outside-namespace'));

    const result = await store.reconcileTasks({
      namespace: 'representative-',
      desired: [
        { ...createTask('representative-live'), task: 'Do not replace the live task.' },
        createTask('representative-new'),
      ],
    });

    expect(result.created).toEqual([expect.objectContaining({ id: 'representative-new' })]);
    expect(result.deleted).toEqual([expect.objectContaining({ id: 'representative-obsolete' })]);
    expect(result.preservedRunning).toEqual([expect.objectContaining({
      id: 'representative-live',
      state: expect.objectContaining({
        execution: expect.objectContaining({ executionId: 'live-execution' }),
      }),
    })]);
    await expect(store.requireTask('representative-live')).resolves.toMatchObject({
      task: 'Keep this claimed task intact.',
      state: {
        status: 'running',
        execution: { executionId: 'live-execution' },
        runRequest: { generation: 3, claimedGeneration: 3 },
      },
    });
    await expect(store.loadCheckpoint(liveTask)).resolves.toEqual(checkpoint);
    await expect(store.listTasks()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'representative-live' }),
      expect.objectContaining({ id: 'representative-new' }),
      expect.objectContaining({ id: 'outside-namespace' }),
    ]));
    await expect(store.requireTask('representative-obsolete')).rejects.toThrow(/not found/i);
  });

  it('allows scheduler polling to overlap host mutations without malformed reads', async () => {
    const stateRoot = mkdtempSync(join(tmpdir(), 'heddle-heartbeat-file-scheduler-'));
    const store = new FileHeartbeatTaskService({ stateRoot });
    await store.saveTask(createTask('polling-task'));
    const started = deferred<void>();
    const release = deferred<void>();
    const scheduler = HeartbeatSchedulerService.start({
      workspaceRoot: stateRoot,
      stateRoot,
      store,
      pollIntervalMs: 60_000,
      now: () => NOW,
      handler: async (context) => {
        started.resolve();
        await release.promise;
        return context.skip({ summary: 'No work available.' });
      },
    });
    await started.promise;

    await expect(Promise.all([
      store.createTask({ id: 'host-added', task: 'Add while polling.' }),
      store.requestTaskRun('polling-task', { reason: 'new-work', requestedAt: NOW }),
      store.listTasks(),
      store.listTaskViews(),
    ])).resolves.toHaveLength(4);

    release.resolve();
    await scheduler.stop({ cancelRunning: true });
    await expect(store.requireTask('host-added')).resolves.toMatchObject({ id: 'host-added' });
    expectValidTaskFiles(join(stateRoot, 'heartbeat'));
  });
});

function createTask(id: string): HeartbeatTask {
  return {
    id,
    task: `Run ${id}.`,
    enabled: true,
    schedule: {
      intervalMs: 60_000,
      nextRunAt: '2000-01-01T00:00:00.000Z',
    },
    state: {
      status: 'waiting',
      resumable: true,
    },
  };
}

function expectValidTaskFiles(heartbeatRoot: string): void {
  readdirSync(join(heartbeatRoot, 'tasks'))
    .filter((entry) => entry.endsWith('.json'))
    .forEach((entry) => expect(() => JSON.parse(readFileSync(join(heartbeatRoot, 'tasks', entry), 'utf8'))).not.toThrow());
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
