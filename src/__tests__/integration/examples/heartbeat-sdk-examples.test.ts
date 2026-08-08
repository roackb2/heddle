import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  FileHeartbeatTaskService,
  HeartbeatRunnerAgent,
  HeartbeatSchedulerService,
  type HeartbeatTask,
} from '../../../advanced.js';

describe('heartbeat SDK examples', () => {
  it('reconciles a task, preserves its state, wakes on a durable request, and stops gracefully without a model', async () => {
    const stateRoot = mkdtempSync(join(tmpdir(), 'heddle-heartbeat-sdk-example-'));
    const store = new FileHeartbeatTaskService({ stateRoot });
    const task: HeartbeatTask = {
      id: 'example-task',
      task: 'Process host-owned work when one is available.',
      enabled: true,
      schedule: { intervalMs: 60_000, nextRunAt: '2000-01-01T00:00:00.000Z' },
      runtime: { model: 'gpt-test', maxSteps: 2, workspaceRoot: stateRoot },
    };
    await store.reconcileTasks({ namespace: 'example-', desired: [task] });
    await expect(store.requireTask(task.id)).resolves.toMatchObject({ id: task.id, enabled: true });

    const runAgent = vi.spyOn(HeartbeatRunnerAgent, 'run');
    const firstCycle = await HeartbeatSchedulerService.runDueTasks({
      store,
      now: () => new Date('2026-08-08T00:00:00.000Z'),
      handler: async (context) => context.skip({ summary: 'No host work is available.' }),
    });
    expect(firstCycle).toMatchObject({ checked: 1, ran: 1, failed: 0 });
    await expect(store.requireTask(task.id)).resolves.toMatchObject({
      task: task.task,
      state: { lastExecution: { kind: 'skipped', summary: 'No host work is available.' } },
    });

    await store.reconcileTasks({
      namespace: 'example-',
      desired: [{ ...task, task: 'A startup reconciliation must not replace the stored task.' }],
    });
    await expect(store.requireTask(task.id)).resolves.toMatchObject({
      task: task.task,
      state: { lastExecution: { kind: 'skipped', summary: 'No host work is available.' } },
    });

    let started: () => void;
    const schedulerStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    let settled: () => void;
    const requestSettled = new Promise<void>((resolve) => {
      settled = resolve;
    });
    const scheduler = HeartbeatSchedulerService.start({
      workspaceRoot: stateRoot,
      stateRoot,
      store,
      pollIntervalMs: 60_000,
      handler: async (context) => context.skip({ summary: 'The requested host work was coalesced.' }),
      onEvent: (event) => {
        if (event.type === 'heartbeat.scheduler.started') {
          started();
        }
        if (event.type === 'heartbeat.task.skipped' && event.record.outcome.summary === 'The requested host work was coalesced.') {
          settled();
        }
      },
    });
    await schedulerStarted;

    await expect(store.requestTaskRun(task.id, { reason: 'host-event-arrived' })).resolves.toMatchObject({
      disposition: 'requested',
      generation: 1,
    });
    await requestSettled;
    await scheduler.stop();

    expect(runAgent).not.toHaveBeenCalled();
    await expect(store.requireTask(task.id)).resolves.toMatchObject({
      state: {
        runRequest: { generation: 1, claimedGeneration: 1 },
        lastExecution: { kind: 'skipped', summary: 'The requested host work was coalesced.' },
      },
    });
  });
});
