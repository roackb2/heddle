import { describe, expect, it, vi } from 'vitest';
import {
  HeartbeatSchedulerService,
  type HeartbeatTask,
  type HeartbeatTaskExecution,
  type HeartbeatTaskRunRecord,
  type HeartbeatTaskRunRequestSignal,
  type HeartbeatTaskStore,
} from '../../../advanced.js';
import { HeartbeatTaskStateProjector } from '@/core/heartbeat/index.js';

const NOW = new Date('2026-08-04T06:00:00.000Z');

describe('heartbeat scheduler custom store lifecycle', () => {
  it('uses the supplied store for recovery, wake-up, claim, settlement, and run history', async () => {
    const store = new InstrumentedHeartbeatTaskStore(createTask());
    const handlerStarted = deferred<void>();
    const runSettled = deferred<void>();
    const handle = HeartbeatSchedulerService.start({
      workspaceRoot: '/tmp/heddle-custom-store-workspace',
      stateRoot: '/tmp/heddle-custom-store-runtime',
      store,
      pollIntervalMs: 60_000,
      handler: async (context) => {
        handlerStarted.resolve();
        return context.skip({ summary: 'The custom store had no domain work.' });
      },
      onEvent: (event) => {
        if (event.type === 'heartbeat.task.skipped') {
          runSettled.resolve();
        }
      },
    });

    await store.firstScan;
    await store.requestTaskRun('custom-store-task', {
      reason: 'remote-notification',
      requestedAt: NOW,
    });
    await handlerStarted.promise;
    await runSettled.promise;
    await handle.stop();

    expect(store.calls).toEqual([
      'subscribeToRunRequests',
      'recoverInterruptedTasks',
      'listTasks',
      'requestTaskRun',
      'listTasks',
      'loadCheckpoint',
      'claimTaskExecution',
      'recordTaskExecutionOutcome',
      'unsubscribeFromRunRequests',
    ]);
    expect(store.recoveryCalls).toBe(1);
    expect(store.runRecords).toMatchObject([{
      task: { id: 'custom-store-task' },
      outcome: {
        kind: 'skipped',
        runRequestGeneration: 1,
        summary: 'The custom store had no domain work.',
      },
    }]);
  });

  it('keeps stop idempotent and surfaces a custom-store loop failure consistently', async () => {
    const failure = new Error('remote heartbeat store unavailable');
    const errorReported = deferred<unknown>();
    const store = new InstrumentedHeartbeatTaskStore(createTask());
    store.recoveryError = failure;
    const onError = vi.fn((error: unknown) => errorReported.resolve(error));
    const handle = HeartbeatSchedulerService.start({
      workspaceRoot: '/tmp/heddle-custom-store-error-workspace',
      stateRoot: '/tmp/heddle-custom-store-error-runtime',
      store,
      onError,
    });

    await expect(errorReported.promise).resolves.toBe(failure);
    const firstStop = handle.stop();
    expect(handle.stop({ cancelRunning: true })).toBe(firstStop);
    await expect(firstStop).rejects.toBe(failure);
    expect(onError).toHaveBeenCalledOnce();
    expect(store.calls).toEqual([
      'subscribeToRunRequests',
      'recoverInterruptedTasks',
      'unsubscribeFromRunRequests',
    ]);
  });
});

class InstrumentedHeartbeatTaskStore implements HeartbeatTaskStore {
  readonly calls: string[] = [];
  readonly firstScan: Promise<void>;
  readonly runRecords: HeartbeatTaskRunRecord[] = [];
  recoveryCalls = 0;
  recoveryError?: Error;

  private readonly firstScanReady = deferred<void>();
  private readonly listeners = new Set<(request: HeartbeatTaskRunRequestSignal) => void>();
  private task: HeartbeatTask;

  constructor(task: HeartbeatTask) {
    this.task = task;
    this.firstScan = this.firstScanReady.promise;
  }

  async listTasks(): Promise<HeartbeatTask[]> {
    this.calls.push('listTasks');
    this.firstScanReady.resolve();
    return [structuredClone(this.task)];
  }

  async saveTask(task: HeartbeatTask): Promise<void> {
    this.calls.push('saveTask');
    this.task = structuredClone(task);
  }

  async loadCheckpoint(): Promise<undefined> {
    this.calls.push('loadCheckpoint');
    return undefined;
  }

  async saveCheckpoint(): Promise<void> {
    this.calls.push('saveCheckpoint');
  }

  async requestTaskRun(
    taskId: string,
    options: Parameters<HeartbeatTaskStore['requestTaskRun']>[1] = {},
  ) {
    this.calls.push('requestTaskRun');
    if (taskId !== this.task.id) {
      throw new Error(`Heartbeat task not found: ${taskId}`);
    }

    const projection = HeartbeatTaskStateProjector.requestRun({
      task: this.task,
      now: options.requestedAt ?? NOW,
      reason: options.reason,
    });
    this.task = projection.task;
    const request = projection.task.state?.runRequest;
    if (!request) {
      throw new Error('Expected the custom store to project a run request.');
    }

    const result = {
      task: structuredClone(projection.task),
      taskId,
      generation: request.generation,
      disposition: projection.disposition,
      requestedAt: request.requestedAt,
      reason: request.reason,
    };
    const signal = {
      taskId,
      generation: result.generation,
      disposition: result.disposition,
      requestedAt: result.requestedAt,
      reason: result.reason,
    };
    this.listeners.forEach((listener) => listener(signal));
    return result;
  }

  subscribeToRunRequests(listener: (request: HeartbeatTaskRunRequestSignal) => void): () => void {
    this.calls.push('subscribeToRunRequests');
    this.listeners.add(listener);
    return () => {
      this.calls.push('unsubscribeFromRunRequests');
      this.listeners.delete(listener);
    };
  }

  async claimTaskExecution(input: Parameters<HeartbeatTaskStore['claimTaskExecution']>[0]) {
    this.calls.push('claimTaskExecution');
    if (input.taskId !== this.task.id) {
      return { status: 'not-found' } as const;
    }
    if (!this.task.enabled) {
      return { status: 'disabled' } as const;
    }
    if (this.task.state?.status === 'running') {
      return { status: 'busy' } as const;
    }

    this.task = HeartbeatTaskStateProjector.markRunning({
      task: this.task,
      now: input.claimedAt,
      loadedCheckpoint: input.loadedCheckpoint,
      execution: input.execution,
    });
    return { status: 'claimed', task: structuredClone(this.task) } as const;
  }

  async completeTaskExecution(): Promise<never> {
    throw new Error('This test store did not expect an agent completion.');
  }

  async failTaskExecution(): Promise<never> {
    throw new Error('This test store did not expect an execution failure.');
  }

  async recordTaskExecutionOutcome(input: Parameters<HeartbeatTaskStore['recordTaskExecutionOutcome']>[0]) {
    this.calls.push('recordTaskExecutionOutcome');
    if (!this.executionMatches(input.execution)) {
      return { status: 'claim-lost' } as const;
    }
    if (input.signal?.aborted) {
      return { status: 'cancelled' } as const;
    }

    this.task = input.kind === 'skipped' ?
      HeartbeatTaskStateProjector.afterSkip({
        task: this.task,
        execution: input.execution,
        summary: input.summary,
        now: input.finishedAt,
      })
    : HeartbeatTaskStateProjector.afterCancellation({
        task: this.task,
        execution: input.execution,
        summary: input.summary,
        now: input.finishedAt,
      });
    const outcome = this.task.state?.lastExecution;
    if (!outcome || outcome.kind !== input.kind) {
      throw new Error(`Expected a ${input.kind} outcome.`);
    }
    const record: HeartbeatTaskRunRecord = {
      task: structuredClone(this.task),
      outcome,
    };
    this.runRecords.push(record);
    return { status: 'saved', task: structuredClone(this.task), record } as const;
  }

  async recoverInterruptedTasks() {
    this.calls.push('recoverInterruptedTasks');
    this.recoveryCalls++;
    if (this.recoveryError) {
      throw this.recoveryError;
    }
    return [];
  }

  private executionMatches(execution: HeartbeatTaskExecution): boolean {
    return this.task.state?.execution?.executionId === execution.executionId
      && this.task.state.execution.ownerId === execution.ownerId;
  }
}

function createTask(): HeartbeatTask {
  return {
    id: 'custom-store-task',
    task: 'Process custom-store work.',
    enabled: true,
    schedule: {
      intervalMs: 60_000,
      nextRunAt: '2099-01-01T00:00:00.000Z',
    },
    state: {
      status: 'waiting',
      resumable: true,
    },
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
