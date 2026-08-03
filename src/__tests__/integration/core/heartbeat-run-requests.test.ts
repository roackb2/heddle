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
import { AgentLoopCheckpointService } from '@/core/runtime/loop/index.js';

const NOW = new Date('2026-08-04T00:00:00.000Z');

describe('heartbeat run requests', () => {
  it('coalesces concurrent requests during a run and preserves one follow-up across service reconstruction', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'heddle-heartbeat-run-request-coalesce-'));
    const store = new FileHeartbeatTaskService({ dir });
    await store.saveTask(createTask());
    const firstStarted = deferred<void>();
    const firstResult = deferred<AgentHeartbeatResult>();

    const firstRun = HeartbeatSchedulerService.runDueTasks({
      store,
      now: () => NOW,
      runner: async () => {
        firstStarted.resolve();
        return await firstResult.promise;
      },
    });
    await firstStarted.promise;

    const requests = await Promise.all(Array.from({ length: 10 }, async () => (
      await new FileHeartbeatTaskService({ dir }).requestTaskRun('mailbox-consumer', {
        reason: 'new-work-available',
        requestedAt: NOW,
      })
    )));
    expect(requests.filter((request) => request.disposition === 'requested')).toHaveLength(1);
    expect(requests.filter((request) => request.disposition === 'coalesced')).toHaveLength(9);
    await store.updateTask('mailbox-consumer', { name: 'Updated while running' });

    firstResult.resolve(createHeartbeatResult('run-initial'));
    await expect(firstRun).resolves.toMatchObject({ checked: 1, ran: 1, failed: 0 });

    const reconstructed = new FileHeartbeatTaskService({ dir });
    await expect(reconstructed.listTaskViews()).resolves.toMatchObject([{
      name: 'Updated while running',
      state: {
        status: 'waiting',
        runRequest: {
          generation: 10,
          claimedGeneration: 0,
          pending: true,
          requestedAt: NOW.toISOString(),
          reason: 'new-work-available',
        },
      },
    }]);

    const followUpEvents: HeartbeatSchedulerEvent[] = [];
    await expect(HeartbeatSchedulerService.runDueTasks({
      store: reconstructed,
      now: () => NOW,
      onEvent: (event) => followUpEvents.push(event),
      runner: async () => createHeartbeatResult('run-follow-up'),
    })).resolves.toMatchObject({ checked: 1, ran: 1, failed: 0 });
    expect(followUpEvents).toContainEqual(expect.objectContaining({
      type: 'heartbeat.task.run_request_claimed',
      generation: 10,
    }));
    await expect(reconstructed.listTaskViews()).resolves.toMatchObject([{
      state: {
        runRequest: {
          generation: 10,
          claimedGeneration: 10,
          pending: false,
        },
        lastExecution: {
          runRequestGeneration: 10,
        },
      },
    }]);
    await expect(HeartbeatSchedulerService.runDueTasks({
      store: reconstructed,
      now: () => NOW,
      runner: async () => createHeartbeatResult('unexpected-run'),
    })).resolves.toMatchObject({ checked: 0, ran: 0, failed: 0 });
  });

  it('retains a request that arrives after the current follow-up generation was claimed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'heddle-heartbeat-run-request-after-claim-'));
    const store = new FileHeartbeatTaskService({ dir });
    await store.saveTask(createTask());
    await store.requestTaskRun('mailbox-consumer', { reason: 'first-event', requestedAt: NOW });
    const followUpStarted = deferred<void>();
    const followUpResult = deferred<AgentHeartbeatResult>();

    const followUp = HeartbeatSchedulerService.runDueTasks({
      store,
      now: () => NOW,
      runner: async () => {
        followUpStarted.resolve();
        return await followUpResult.promise;
      },
    });
    await followUpStarted.promise;
    await store.requestTaskRun('mailbox-consumer', { reason: 'second-event', requestedAt: NOW });
    followUpResult.resolve(createHeartbeatResult('run-claimed-first-generation'));
    await followUp;

    await expect(store.listTaskViews()).resolves.toMatchObject([{
      state: {
        runRequest: {
          generation: 2,
          claimedGeneration: 1,
          pending: true,
          reason: 'second-event',
        },
      },
    }]);
    await expect(HeartbeatSchedulerService.runDueTasks({
      store,
      now: () => NOW,
      runner: async () => createHeartbeatResult('run-claimed-second-generation'),
    })).resolves.toMatchObject({ checked: 1, ran: 1, failed: 0 });
  });

  it('preserves a newer pending request when the active execution fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'heddle-heartbeat-run-request-failure-'));
    const store = new FileHeartbeatTaskService({ dir });
    await store.saveTask(createTask());
    const runStarted = deferred<void>();
    const rejectRun = deferred<AgentHeartbeatResult>();
    const events: HeartbeatSchedulerEvent[] = [];

    const run = HeartbeatSchedulerService.runDueTasks({
      store,
      now: () => NOW,
      failureRetryMs: 60_000,
      onEvent: (event) => events.push(event),
      runner: async () => {
        runStarted.resolve();
        return await rejectRun.promise;
      },
    });
    await runStarted.promise;
    await store.requestTaskRun('mailbox-consumer', { reason: 'work-arrived-during-failure', requestedAt: NOW });
    rejectRun.reject(new Error('temporary failure'));

    await expect(run).resolves.toMatchObject({ checked: 1, ran: 0, failed: 1 });
    await expect(store.listTaskViews()).resolves.toMatchObject([{
      schedule: { nextRunAt: '2026-08-03T23:59:59.000Z' },
      state: {
        status: 'waiting',
        error: 'temporary failure',
        runRequest: {
          pending: true,
          reason: 'work-arrived-during-failure',
        },
      },
    }]);
    expect(events.at(-1)).toMatchObject({
      type: 'heartbeat.task.failed',
      status: 'waiting',
      nextRunAt: '2026-08-03T23:59:59.000Z',
    });
  });

  it('preserves a disable made during execution and consumes its pending follow-up', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'heddle-heartbeat-run-request-disable-'));
    const store = new FileHeartbeatTaskService({ dir });
    await store.saveTask(createTask());
    const runStarted = deferred<void>();
    const runResult = deferred<AgentHeartbeatResult>();

    const run = HeartbeatSchedulerService.runDueTasks({
      store,
      now: () => NOW,
      runner: async () => {
        runStarted.resolve();
        return await runResult.promise;
      },
    });
    await runStarted.promise;
    await store.requestTaskRun('mailbox-consumer', { reason: 'work-arrived', requestedAt: NOW });
    await store.setTaskEnabled('mailbox-consumer', false);
    runResult.resolve(createHeartbeatResult('run-disabled-during-execution'));

    await expect(run).resolves.toMatchObject({ checked: 1, ran: 1, failed: 0 });
    const [settledTask] = await store.listTaskViews();
    expect(settledTask).toMatchObject({
      enabled: false,
      state: {
        status: 'idle',
        runRequest: {
          generation: 1,
          claimedGeneration: 1,
          pending: false,
        },
      },
    });
    expect(settledTask?.schedule).not.toHaveProperty('nextRunAt');
  });

  it('rejects hidden requests for disabled, completed, and blocked tasks', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'heddle-heartbeat-run-request-guards-'));
    const store = new FileHeartbeatTaskService({ dir });
    await Promise.all([
      store.saveTask(createTask({
        id: 'disabled',
        enabled: false,
        state: { status: 'idle' },
      })),
      store.saveTask(createTask({
        id: 'complete',
        enabled: false,
        state: { status: 'complete' },
      })),
      store.saveTask(createTask({
        id: 'blocked',
        enabled: false,
        state: { status: 'blocked' },
      })),
    ]);

    await expect(store.requestTaskRun('disabled')).rejects.toThrow(/disabled.*enable/i);
    await expect(store.requestTaskRun('complete')).rejects.toThrow(/complete.*resume/i);
    await expect(store.requestTaskRun('blocked')).rejects.toThrow(/blocked.*resume/i);
    await expect(store.requestTaskRun('disabled', { reason: 'x'.repeat(201) })).rejects.toThrow(/at most 200/i);
    expect((await store.listTasks()).every((task) => task.state?.runRequest === undefined)).toBe(true);
  });

  it('wakes a sleeping scheduler promptly and removes the wake subscription on stop', async () => {
    const stateRoot = mkdtempSync(join(tmpdir(), 'heddle-heartbeat-run-request-wake-'));
    const tasks = new FileHeartbeatTaskService({ stateRoot });
    await tasks.saveTask(createTask({
      schedule: {
        intervalMs: 60_000,
        nextRunAt: '2099-08-04T00:00:00.000Z',
      },
    }));
    const handlerStarted = deferred<void>();
    const releaseHandler = deferred<void>();
    const runSettled = deferred<void>();
    const events: HeartbeatSchedulerEvent[] = [];
    const handle = HeartbeatSchedulerService.start({
      workspaceRoot: stateRoot,
      stateRoot,
      pollIntervalMs: 60_000,
      handler: async (context) => {
        handlerStarted.resolve();
        await releaseHandler.promise;
        return context.skip({ summary: 'No work remained.' });
      },
      onEvent: (event) => {
        events.push(event);
        if (event.type === 'heartbeat.task.skipped') {
          runSettled.resolve();
        }
      },
    });

    await tasks.requestTaskRun('mailbox-consumer', {
      reason: 'new-mail',
      requestedAt: new Date('2000-01-01T00:00:00.000Z'),
    });
    await handlerStarted.promise;
    releaseHandler.resolve();
    await runSettled.promise;
    await handle.stop();

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'heartbeat.task.run_requested', reason: 'new-mail' }),
      expect.objectContaining({ type: 'heartbeat.scheduler.awakened', taskIds: ['mailbox-consumer'] }),
      expect.objectContaining({ type: 'heartbeat.task.run_request_claimed', generation: 1 }),
    ]));

    const eventCountAfterStop = events.length;
    await tasks.requestTaskRun('mailbox-consumer', {
      reason: 'after-stop',
      requestedAt: new Date('2000-01-01T00:00:00.000Z'),
    });
    expect(events).toHaveLength(eventCountAfterStop);
  });
});

function createTask(partial: Partial<HeartbeatTask> = {}): HeartbeatTask {
  return {
    id: 'mailbox-consumer',
    task: 'Process newly available mailbox work.',
    enabled: true,
    schedule: {
      intervalMs: 60_000,
      nextRunAt: '2026-08-03T23:59:00.000Z',
    },
    state: {
      status: 'waiting',
      resumable: true,
    },
    ...partial,
  };
}

function createHeartbeatResult(runId: string): AgentHeartbeatResult {
  const summary = 'Heartbeat result.\n\nHEARTBEAT_DECISION: continue';
  const state = {
    status: 'finished' as const,
    runId,
    goal: 'Heartbeat runner cycle.',
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

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}
