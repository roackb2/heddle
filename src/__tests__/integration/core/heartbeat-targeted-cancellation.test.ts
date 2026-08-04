import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FileHeartbeatTaskService,
  HeartbeatSchedulerService,
  MAX_HEARTBEAT_CANCELLATION_REASON_LENGTH,
  type AgentHeartbeatResult,
  type HeartbeatExecutionContext,
  type HeartbeatSchedulerEvent,
  type HeartbeatTask,
} from '../../../advanced.js';
import { AgentLoopCheckpointService } from '@/core/runtime/loop/index.js';

const NOW = new Date('2026-08-04T07:00:00.000Z');

describe('heartbeat targeted cancellation', () => {
  it('cancels and settles one active task without aborting its peer', async () => {
    const stateRoot = createStateRoot('active');
    const store = new FileHeartbeatTaskService({ stateRoot });
    const targetTask = createTask('target-task');
    const peerTask = createTask('peer-task');
    const priorCheckpoint = createHeartbeatResult('prior-target-run').checkpoint;
    await Promise.all([
      store.saveTask(targetTask),
      store.saveTask(peerTask),
      store.saveCheckpoint(targetTask, priorCheckpoint),
    ]);
    const contexts = new Map<string, HeartbeatExecutionContext>();
    const started = new Map([
      [targetTask.id, deferred<void>()],
      [peerTask.id, deferred<void>()],
    ]);
    const releases = new Map([
      [targetTask.id, deferred<void>()],
      [peerTask.id, deferred<void>()],
    ]);
    const peerSettled = deferred<void>();
    let peerHandlerSettled = false;
    let peerAbortBeforeSettlement = false;
    const events: HeartbeatSchedulerEvent[] = [];
    const handle = HeartbeatSchedulerService.start({
      workspaceRoot: stateRoot,
      stateRoot,
      store,
      maxConcurrentTasks: 2,
      pollIntervalMs: 60_000,
      handler: async (context) => {
        contexts.set(context.task.id, context);
        if (context.task.id === peerTask.id) {
          context.signal.addEventListener('abort', () => {
            peerAbortBeforeSettlement ||= !peerHandlerSettled;
          });
        }
        started.get(context.task.id)?.resolve();
        await releases.get(context.task.id)?.promise;
        if (context.task.id === peerTask.id) {
          peerHandlerSettled = true;
        }
        return context.skip({ summary: `Settled ${context.task.id}.` });
      },
      onEvent: (event) => {
        events.push(event);
        if (event.type === 'heartbeat.task.skipped' && event.taskId === peerTask.id) {
          peerSettled.resolve();
        }
      },
    });

    await Promise.all([...started.values()].map(async (gate) => await gate.promise));
    await store.requestTaskRun(targetTask.id, {
      reason: 'work-arrived-during-active-run',
      requestedAt: NOW,
    });
    const firstCancellation = handle.cancelTask(targetTask.id, {
      reason: '  operator-disabled\nparticipant  ',
    });
    const repeatedCancellation = handle.cancelTask(targetTask.id, {
      reason: 'the first concurrent caller owns the reason',
    });

    expect(repeatedCancellation).toBe(firstCancellation);
    expect(contexts.get(targetTask.id)?.signal.aborted).toBe(true);
    expect(contexts.get(peerTask.id)?.signal.aborted).toBe(false);
    let cancellationSettled = false;
    void firstCancellation.then(() => {
      cancellationSettled = true;
    });
    await Promise.resolve();
    expect(cancellationSettled).toBe(false);

    releases.get(targetTask.id)?.resolve();
    const cancellation = await firstCancellation;
    expect(cancellation).toMatchObject({
      taskId: targetTask.id,
      disposition: 'cancelled',
      reason: 'operator-disabled participant',
      executionId: contexts.get(targetTask.id)?.executionId,
      record: {
        outcome: {
          kind: 'cancelled',
          reason: 'operator-disabled participant',
          summary: expect.stringContaining('operator-disabled participant'),
        },
      },
    });
    await expect(repeatedCancellation).resolves.toEqual(cancellation);
    await expect(store.loadCheckpoint(targetTask)).resolves.toEqual(priorCheckpoint);
    await expect(store.requireTask(targetTask.id)).resolves.toMatchObject({
      enabled: true,
      state: {
        status: 'waiting',
        lastExecution: {
          kind: 'cancelled',
          reason: 'operator-disabled participant',
        },
        runRequest: {
          generation: 1,
          claimedGeneration: 0,
        },
      },
    });
    expect((await store.requireTask(targetTask.id)).schedule.nextRunAt).toBeDefined();

    const targetRuns = await store.listRunRecords({ taskId: targetTask.id });
    expect(targetRuns).toHaveLength(1);
    expect(targetRuns[0]).toMatchObject({
      executionId: contexts.get(targetTask.id)?.executionId,
      record: { outcome: { kind: 'cancelled', reason: 'operator-disabled participant' } },
    });
    expect(events.find((event) => event.type === 'heartbeat.task.cancelled')).toMatchObject({
      taskId: targetTask.id,
      reason: 'operator-disabled participant',
    });

    const startedEvent = events.find((event) =>
      event.type === 'heartbeat.task.started' && event.taskId === targetTask.id,
    );
    if (!startedEvent || startedEvent.type !== 'heartbeat.task.started') {
      throw new Error('Expected the target heartbeat execution to start.');
    }
    const execution = {
      executionId: startedEvent.executionId,
      ownerId: startedEvent.ownerId,
      claimedAt: startedEvent.timestamp,
    };
    const lateResult = createHeartbeatResult('late-target-result');
    await expect(store.completeTaskExecution({
      taskId: targetTask.id,
      execution,
      result: lateResult,
      checkpoint: lateResult.checkpoint,
      loadedCheckpoint: true,
      completedAt: NOW,
    })).resolves.toEqual({ status: 'claim-lost' });
    await expect(store.failTaskExecution({
      taskId: targetTask.id,
      execution,
      error: new Error('late target failure'),
      failedAt: NOW,
      retryMs: 1_000,
    })).resolves.toEqual({ status: 'claim-lost' });
    await expect(store.listRunRecords({ taskId: targetTask.id })).resolves.toHaveLength(1);

    await expect(handle.cancelTask(targetTask.id, {
      reason: 'already settled',
    })).resolves.toMatchObject({ disposition: 'not-running' });
    await expect(store.setTaskEnabled(targetTask.id, false)).resolves.toMatchObject({
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

    releases.get(peerTask.id)?.resolve();
    await peerSettled.promise;
    expect(peerAbortBeforeSettlement).toBe(false);
    await handle.stop();
    await expect(store.listRunRecords({ taskId: peerTask.id })).resolves.toMatchObject([{
      record: { outcome: { kind: 'skipped', summary: `Settled ${peerTask.id}.` } },
    }]);
  });

  it('invalidates a queued admission without touching the active task', async () => {
    const stateRoot = createStateRoot('queued');
    const store = new FileHeartbeatTaskService({ stateRoot });
    await Promise.all([
      store.saveTask(createTask('active-first')),
      store.saveTask(createTask('queued-a-target')),
      store.saveTask(createTask('queued-b-peer')),
    ]);
    const activeStarted = deferred<void>();
    const releaseActive = deferred<void>();
    const peerStarted = deferred<void>();
    const handlerCalls: string[] = [];
    const handle = HeartbeatSchedulerService.start({
      workspaceRoot: stateRoot,
      stateRoot,
      store,
      maxConcurrentTasks: 1,
      pollIntervalMs: 60_000,
      handler: async (context) => {
        handlerCalls.push(context.task.id);
        if (context.task.id === 'active-first') {
          activeStarted.resolve();
          await releaseActive.promise;
        }
        if (context.task.id === 'queued-b-peer') {
          peerStarted.resolve();
        }
        return context.skip({ summary: `Settled ${context.task.id}.` });
      },
    });

    await activeStarted.promise;
    await expect(handle.cancelTask('queued-a-target', {
      reason: 'operator-cancelled-before-admission',
    })).resolves.toMatchObject({ disposition: 'not-running' });
    releaseActive.resolve();
    await peerStarted.promise;

    expect(handlerCalls).toEqual(['active-first', 'queued-b-peer']);
    await handle.stop();
    await expect(store.listRunRecords({ taskId: 'queued-a-target' })).resolves.toEqual([]);
    await expect(store.listRunRecords({ taskId: 'queued-b-peer' })).resolves.toHaveLength(1);
  });

  it('retains a concurrent disable and permits deletion immediately after settlement', async () => {
    const stateRoot = createStateRoot('disable-delete');
    const store = new FileHeartbeatTaskService({ stateRoot });
    await store.saveTask(createTask('disable-me'));
    const handlerStarted = deferred<void>();
    const releaseHandler = deferred<void>();
    const handle = HeartbeatSchedulerService.start({
      workspaceRoot: stateRoot,
      stateRoot,
      store,
      handler: async (context) => {
        handlerStarted.resolve();
        await releaseHandler.promise;
        return context.skip({ summary: 'Late handler settlement.' });
      },
    });

    await handlerStarted.promise;
    const cancellation = handle.cancelTask('disable-me', {
      reason: 'operator-disabled-task',
    });
    await expect(store.setTaskEnabled('disable-me', false)).resolves.toMatchObject({
      enabled: false,
      state: { status: 'running' },
    });
    releaseHandler.resolve();

    await expect(cancellation).resolves.toMatchObject({ disposition: 'cancelled' });
    const disabledTask = await store.requireTask('disable-me');
    expect(disabledTask).toMatchObject({
      enabled: false,
      state: { status: 'idle', lastExecution: { kind: 'cancelled' } },
    });
    expect(disabledTask.schedule).not.toHaveProperty('nextRunAt');
    await expect(store.deleteTask('disable-me')).resolves.toMatchObject({ id: 'disable-me' });
    await handle.stop();
  });

  it('reports when completion wins the cancellation race', async () => {
    const stateRoot = createStateRoot('completion-race');
    const store = new FileHeartbeatTaskService({ stateRoot });
    await store.saveTask(createTask('completion-wins'));
    const completionSaved = deferred<void>();
    const releaseCompletionReturn = deferred<void>();
    const completeTaskExecution = store.completeTaskExecution.bind(store);
    store.completeTaskExecution = async (input) => {
      const result = await completeTaskExecution(input);
      completionSaved.resolve();
      await releaseCompletionReturn.promise;
      return result;
    };
    const events: HeartbeatSchedulerEvent[] = [];
    const handle = HeartbeatSchedulerService.start({
      workspaceRoot: stateRoot,
      stateRoot,
      store,
      runner: async () => createHeartbeatResult('completion-wins-run'),
      onEvent: (event) => events.push(event),
    });

    await completionSaved.promise;
    const cancellation = handle.cancelTask('completion-wins', {
      reason: 'operator-raced-with-completion',
    });
    releaseCompletionReturn.resolve();

    await expect(cancellation).resolves.toMatchObject({
      disposition: 'completion-won',
      record: { outcome: { kind: 'agent' } },
    });
    await handle.stop();
    expect(events.some((event) => event.type === 'heartbeat.task.cancelled')).toBe(false);
    await expect(store.listRunRecords({ taskId: 'completion-wins' })).resolves.toHaveLength(1);
  });

  it('returns explicit dispositions for tasks this handle cannot cancel', async () => {
    const stateRoot = createStateRoot('dispositions');
    const store = new FileHeartbeatTaskService({ stateRoot });
    store.recoverInterruptedTasks = async () => [];
    await Promise.all([
      store.saveTask(createTask('waiting', { nextRunAt: '2099-01-01T00:00:00.000Z' })),
      store.saveTask({
        ...createTask('disabled'),
        enabled: false,
        state: { status: 'idle' },
      }),
      store.saveTask({
        ...createTask('blocked'),
        enabled: false,
        state: { status: 'blocked' },
      }),
      store.saveTask({
        ...createTask('completed'),
        enabled: false,
        state: { status: 'complete' },
      }),
      store.saveTask({
        ...createTask('foreign-running'),
        state: {
          status: 'running',
          execution: {
            executionId: 'foreign-execution',
            ownerId: 'foreign-worker',
            claimedAt: NOW.toISOString(),
          },
        },
      }),
    ]);
    const handle = HeartbeatSchedulerService.start({
      workspaceRoot: stateRoot,
      stateRoot,
      store,
      pollIntervalMs: 60_000,
    });

    await expect(handle.cancelTask('waiting', { reason: 'classification' })).resolves.toMatchObject({
      disposition: 'not-running',
    });
    await expect(handle.cancelTask('disabled', { reason: 'classification' })).resolves.toMatchObject({
      disposition: 'disabled',
    });
    await expect(handle.cancelTask('blocked', { reason: 'classification' })).resolves.toMatchObject({
      disposition: 'blocked',
    });
    await expect(handle.cancelTask('completed', { reason: 'classification' })).resolves.toMatchObject({
      disposition: 'completed',
    });
    await expect(handle.cancelTask('foreign-running', { reason: 'classification' })).resolves.toMatchObject({
      disposition: 'not-owned',
    });
    await expect(handle.cancelTask('unknown', { reason: 'classification' })).resolves.toMatchObject({
      disposition: 'not-found',
    });
    await expect(handle.cancelTask('waiting', { reason: '   ' })).rejects.toThrow(/cannot be empty/i);
    await expect(handle.cancelTask('waiting', {
      reason: 'x'.repeat(MAX_HEARTBEAT_CANCELLATION_REASON_LENGTH + 1),
    })).rejects.toThrow(/at most 200/i);
    await handle.stop();
  });
});

function createStateRoot(label: string): string {
  return mkdtempSync(join(tmpdir(), `heddle-heartbeat-targeted-cancel-${label}-`));
}

function createTask(id: string, schedule: Partial<HeartbeatTask['schedule']> = {}): HeartbeatTask {
  return {
    id,
    task: `Process ${id}.`,
    enabled: true,
    schedule: {
      intervalMs: 60_000,
      nextRunAt: '2000-01-01T00:00:00.000Z',
      ...schedule,
    },
    state: {
      status: 'waiting',
      resumable: true,
    },
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
