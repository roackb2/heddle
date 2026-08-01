import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FileHeartbeatTaskService,
  HeartbeatSchedulerService,
  type HeartbeatSchedulerEvent,
  type HeartbeatTask,
  type HeartbeatTaskStore,
} from '../../../advanced.js';
import type { AgentHeartbeatResult } from '@/core/heartbeat/index.js';
import { HeartbeatTaskStateProjector } from '@/core/heartbeat/index.js';
import { AgentLoopCheckpointService, type AgentLoopCheckpoint } from '@/core/runtime/loop/index.js';

const NOW = new Date('2026-04-13T00:00:00.000Z');

describe('heartbeat scheduler', () => {
  it('runs due enabled tasks, persists checkpoints, and schedules the next run', async () => {
    const events: HeartbeatSchedulerEvent[] = [];
    const task: HeartbeatTask = {
      id: 'project-maintenance',
      task: 'Maintain this project.',
      enabled: true,
      schedule: {
        intervalMs: 5_000,
        nextRunAt: '2026-04-12T23:59:00.000Z',
      },
    };
    let savedTask: HeartbeatTask | undefined;
    let savedCheckpoint: AgentLoopCheckpoint | undefined;
    const store = createMemoryTaskStore({
      tasks: [task],
      saveTask: (nextTask) => {
        savedTask = nextTask;
      },
      saveCheckpoint: (checkpoint) => {
        savedCheckpoint = checkpoint;
      },
    });

    const result = await HeartbeatSchedulerService.runDueTasks({
      store,
      now: () => NOW,
      onEvent: (event) => events.push(event),
      runner: async () => createHeartbeatResult('continue'),
    });

    expect(result).toMatchObject({ checked: 1, ran: 1, failed: 0 });
    expect(savedCheckpoint).toMatchObject({ version: 1 });
    expect(savedTask).toMatchObject({
      id: 'project-maintenance',
      enabled: true,
      schedule: {
        nextRunAt: '2026-04-13T00:00:05.000Z',
      },
      state: {
        status: 'waiting',
        progress: 'Heartbeat runner finished. Waiting until the next scheduled run in 5s.',
        runId: 'run-continue',
        loadedCheckpoint: false,
        resumable: true,
        result: {
          decision: 'continue',
          state: {
            outcome: 'done',
          },
        },
      },
    });
    expect(events.map((event) => event.type)).toEqual([
      'heartbeat.task.due',
      'heartbeat.task.started',
      'heartbeat.task.finished',
    ]);
  });

  it('keeps operator-controlled complete tasks scheduled after the runner cycle', async () => {
    const task: HeartbeatTask = {
      id: 'operator-task',
      task: 'Review this task.',
      enabled: true,
      continuationMode: 'operator',
      schedule: { intervalMs: 60_000 },
    };
    let savedTask: HeartbeatTask | undefined;

    await HeartbeatSchedulerService.runDueTasks({
      store: createMemoryTaskStore({
        tasks: [task],
        saveTask: (nextTask) => {
          savedTask = nextTask;
        },
      }),
      now: () => NOW,
      runner: async () => createHeartbeatResult('complete'),
    });

    expect(savedTask).toMatchObject({
      enabled: true,
      continuationMode: 'operator',
      schedule: { nextRunAt: '2026-04-13T00:01:00.000Z' },
      state: {
        status: 'waiting',
        resumable: true,
        result: {
          decision: 'complete',
        },
      },
    });
  });

  it('lets agent-controlled complete tasks stop after the runner cycle', async () => {
    const task: HeartbeatTask = {
      id: 'done-task',
      task: 'Finish this task.',
      enabled: true,
      continuationMode: 'agent',
      schedule: { intervalMs: 60_000 },
    };
    let savedTask: HeartbeatTask | undefined;

    await HeartbeatSchedulerService.runDueTasks({
      store: createMemoryTaskStore({
        tasks: [task],
        saveTask: (nextTask) => {
          savedTask = nextTask;
        },
      }),
      now: () => NOW,
      runner: async () => createHeartbeatResult('complete'),
    });

    expect(savedTask).toMatchObject({
      enabled: false,
      schedule: { nextRunAt: undefined },
      state: {
        status: 'complete',
        result: {
          decision: 'complete',
        },
      },
    });
  });

  it('records failures and retries failed tasks later', async () => {
    const task: HeartbeatTask = {
      id: 'flaky-task',
      task: 'Try flaky work.',
      enabled: true,
      schedule: { intervalMs: 60_000 },
    };
    let savedTask: HeartbeatTask | undefined;
    const events: HeartbeatSchedulerEvent[] = [];

    const result = await HeartbeatSchedulerService.runDueTasks({
      store: createMemoryTaskStore({
        tasks: [task],
        saveTask: (nextTask) => {
          savedTask = nextTask;
        },
      }),
      now: () => NOW,
      failureRetryMs: 10_000,
      onEvent: (event) => events.push(event),
      runner: async () => {
        throw new Error('temporary failure');
      },
    });

    expect(result).toMatchObject({ checked: 1, ran: 0, failed: 1 });
    expect(savedTask).toMatchObject({
      enabled: true,
      schedule: {
        nextRunAt: '2026-04-13T00:00:10.000Z',
      },
      state: {
        status: 'failed',
        progress: 'Heartbeat runner failed and will retry later.',
        error: 'temporary failure',
      },
    });
    expect(events.at(-1)).toMatchObject({
      type: 'heartbeat.task.failed',
      taskId: 'flaky-task',
      error: 'temporary failure',
    });
  });

  it('does not start a second run for a task that is already running', async () => {
    let runnerCalls = 0;

    const result = await HeartbeatSchedulerService.runDueTasks({
      store: createMemoryTaskStore({
        tasks: [{
          id: 'running-task',
          task: 'Already running work.',
          enabled: true,
          schedule: {
            intervalMs: 60_000,
            nextRunAt: '2026-04-12T23:59:00.000Z',
          },
          state: {
            status: 'running',
            resumable: true,
            progress: 'Still running.',
          },
        }],
      }),
      now: () => NOW,
      runner: async () => {
        runnerCalls++;
        return createHeartbeatResult('continue');
      },
    });

    expect(result).toMatchObject({ checked: 0, ran: 0, failed: 0 });
    expect(runnerCalls).toBe(0);
  });

  it('includes result details on finished task events', async () => {
    const events: HeartbeatSchedulerEvent[] = [];

    await HeartbeatSchedulerService.runDueTasks({
      store: createMemoryTaskStore({
        tasks: [{
          id: 'summary-task',
          task: 'Summarize work.',
          enabled: true,
          continuationMode: 'agent',
          schedule: { intervalMs: 60_000 },
        }],
      }),
      now: () => NOW,
      onEvent: (event) => events.push(event),
      runner: async () => createHeartbeatResult('pause'),
    });

    expect(events.at(-1)).toMatchObject({
      type: 'heartbeat.task.finished',
      taskId: 'summary-task',
      record: {
        result: {
          decision: 'pause',
          summary: expect.stringContaining('Heartbeat result.'),
          state: {
            outcome: 'done',
            runId: 'run-pause',
          },
        },
        task: {
          state: {
            status: 'waiting',
            progress: 'Heartbeat paused. Waiting 15m before the next run.',
          },
        },
      },
    });
  });

  it('stores tasks and checkpoints in a local heartbeat directory', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'heddle-heartbeat-scheduler-'));
    const store = new FileHeartbeatTaskService({ dir });
    const task: HeartbeatTask = {
      id: 'local-task',
      task: 'Local task.',
      enabled: true,
      schedule: { intervalMs: 60_000 },
      state: { status: 'waiting', resumable: true },
    };
    const checkpoint = createHeartbeatResult('pause').checkpoint;

    await store.saveTask(task);
    await store.saveCheckpoint(task, checkpoint);

    await expect(store.listTasks()).resolves.toEqual([{ ...task, continuationMode: 'operator' }]);
    await expect(store.loadCheckpoint(task)).resolves.toMatchObject({
      version: 1,
      runId: checkpoint.runId,
    });
    expect(readFileSync(join(dir, 'tasks', 'local-task.json'), 'utf8')).toContain('Local task.');
  });

  it('lists stored heartbeat run records newest first', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'heddle-heartbeat-runs-'));
    const store = new FileHeartbeatTaskService({ dir });
    const task: HeartbeatTask = {
      id: 'local-task',
      task: 'Local task.',
      enabled: true,
      schedule: { intervalMs: 60_000 },
      state: { status: 'waiting', resumable: true },
    };

    await store.saveRunRecord?.({
      task,
      result: createHeartbeatResult('pause'),
      loadedCheckpoint: false,
    });

    const runs = await store.listRunRecords?.({ taskId: 'local-task' });
    expect(runs).toHaveLength(1);
    expect(runs?.[0]).toMatchObject({
      taskId: 'local-task',
      runId: 'run-pause',
      record: {
        task: {
          state: {
            status: 'waiting',
          },
        },
        loadedCheckpoint: false,
      },
    });
    await expect(store.loadRunRecord?.('run-pause')).resolves.toMatchObject({
      runId: 'run-pause',
    });
  });

  it('runs the scheduler loop until aborted', async () => {
    const controller = new AbortController();
    const events: HeartbeatSchedulerEvent[] = [];
    let cycles = 0;

    await HeartbeatSchedulerService.runLoop({
      store: createMemoryTaskStore({ tasks: [] }),
      now: () => NOW,
      pollIntervalMs: 1,
      signal: controller.signal,
      sleep: async () => {
        cycles++;
        controller.abort();
      },
      onEvent: (event) => events.push(event),
    });

    expect(cycles).toBe(1);
    expect(events.map((event) => event.type)).toEqual([
      'heartbeat.scheduler.started',
      'heartbeat.scheduler.stopped',
    ]);
    expect(events.at(-1)).toMatchObject({
      type: 'heartbeat.scheduler.stopped',
      reason: 'aborted',
    });
  });

  it('recovers an interrupted file-backed execution without fabricating a completed run', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'heddle-heartbeat-recovery-'));
    const store = new FileHeartbeatTaskService({ dir });
    const checkpoint = createHeartbeatResult('pause').checkpoint;
    const interruptedExecution = {
      executionId: 'execution-before-restart',
      ownerId: 'worker-before-restart',
      claimedAt: '2026-04-12T23:50:00.000Z',
    };
    const task: HeartbeatTask = {
      id: 'recover-me',
      task: 'Resume after restart.',
      enabled: true,
      schedule: { intervalMs: 60_000 },
      state: {
        status: 'running',
        resumable: true,
        loadedCheckpoint: true,
        execution: interruptedExecution,
      },
    };
    await store.saveTask(task);
    await store.saveCheckpoint(task, checkpoint);

    const recovered = await new FileHeartbeatTaskService({ dir }).recoverInterruptedTasks({
      ownerId: 'worker-after-restart',
      recoveredAt: NOW,
      reason: 'host-restart',
    });

    expect(recovered).toHaveLength(1);
    expect(recovered[0]).toMatchObject({
      task: {
        enabled: true,
        schedule: { nextRunAt: '2026-04-12T23:59:59.000Z' },
        state: {
          status: 'waiting',
          execution: undefined,
          recovery: {
            interruptedExecutionId: 'execution-before-restart',
            interruptedOwnerId: 'worker-before-restart',
            recoveredAt: NOW.toISOString(),
            reason: 'host-restart',
          },
        },
      },
    });
    await expect(store.loadCheckpoint(task)).resolves.toMatchObject({ runId: checkpoint.runId });
    await expect(store.listRunRecords()).resolves.toEqual([]);
    await expect(store.recoverInterruptedTasks({
      ownerId: 'worker-after-restart',
      recoveredAt: NOW,
      reason: 'host-restart',
    })).resolves.toEqual([]);
  });

  it('keeps disabled tasks disabled and leaves blocked tasks unchanged during recovery', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'heddle-heartbeat-recovery-state-'));
    const store = new FileHeartbeatTaskService({ dir });
    const interruptedExecution = {
      executionId: 'disabled-interrupted-execution',
      ownerId: 'worker-before-restart',
      claimedAt: '2026-04-12T23:50:00.000Z',
    };
    const disabledTask: HeartbeatTask = {
      id: 'disabled-interrupted-task',
      task: 'Stay disabled after recovery.',
      enabled: false,
      schedule: { intervalMs: 60_000 },
      state: {
        status: 'running',
        resumable: true,
        execution: interruptedExecution,
      },
    };
    const blockedTask: HeartbeatTask = {
      id: 'blocked-task',
      task: 'Wait for operator input.',
      enabled: false,
      schedule: { intervalMs: 60_000 },
      state: {
        status: 'blocked',
        resumable: true,
        progress: 'Waiting for operator input.',
      },
    };
    await store.saveTask(disabledTask);
    await store.saveTask(blockedTask);

    await expect(store.recoverInterruptedTasks({
      ownerId: 'worker-after-restart',
      recoveredAt: NOW,
      reason: 'host-restart',
    })).resolves.toMatchObject([{
      task: {
        id: disabledTask.id,
        enabled: false,
        schedule: { nextRunAt: undefined },
        state: {
          status: 'idle',
          execution: undefined,
          recovery: {
            interruptedExecutionId: interruptedExecution.executionId,
          },
        },
      },
    }]);
    const storedBlockedTask = await store.requireTask(blockedTask.id);
    expect(storedBlockedTask).toMatchObject({
      enabled: false,
      state: {
        status: 'blocked',
        progress: 'Waiting for operator input.',
      },
    });
    expect(storedBlockedTask.state?.recovery).toBeUndefined();
  });

  it('recovers once at scheduler start and retries from the preserved checkpoint', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'heddle-heartbeat-retry-'));
    const store = new FileHeartbeatTaskService({ dir });
    const checkpoint = createHeartbeatResult('pause').checkpoint;
    const task: HeartbeatTask = {
      id: 'retry-me',
      task: 'Retry after restart.',
      enabled: true,
      schedule: { intervalMs: 60_000 },
      state: {
        status: 'running',
        resumable: true,
        execution: {
          executionId: 'interrupted-execution',
          ownerId: 'interrupted-worker',
          claimedAt: '2026-04-12T23:50:00.000Z',
        },
      },
    };
    await store.saveTask(task);
    await store.saveCheckpoint(task, checkpoint);
    const controller = new AbortController();
    const events: HeartbeatSchedulerEvent[] = [];
    let runnerCalls = 0;
    let loadedCheckpoint: AgentLoopCheckpoint | undefined;

    await HeartbeatSchedulerService.runLoop({
      store: new FileHeartbeatTaskService({ dir }),
      executionOwnerId: 'replacement-worker',
      now: () => NOW,
      pollIntervalMs: 1,
      signal: controller.signal,
      sleep: async () => controller.abort(),
      onEvent: (event) => events.push(event),
      runner: async (_task, loaded) => {
        runnerCalls++;
        loadedCheckpoint = loaded as AgentLoopCheckpoint;
        return createHeartbeatResult('continue');
      },
    });

    expect(runnerCalls).toBe(1);
    expect(loadedCheckpoint).toMatchObject({ runId: checkpoint.runId });
    expect(events.map((event) => event.type)).toEqual([
      'heartbeat.scheduler.started',
      'heartbeat.task.recovered',
      'heartbeat.task.due',
      'heartbeat.task.started',
      'heartbeat.task.finished',
      'heartbeat.scheduler.stopped',
    ]);
    expect(events[1]).toMatchObject({
      type: 'heartbeat.task.recovered',
      interruptedExecutionId: 'interrupted-execution',
      interruptedOwnerId: 'interrupted-worker',
    });
    await expect(store.listRunRecords()).resolves.toHaveLength(1);
  });

  it('does not recover or double-claim an execution that is active in this process', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'heddle-heartbeat-live-'));
    const firstStore = new FileHeartbeatTaskService({ dir });
    const secondStore = new FileHeartbeatTaskService({ dir });
    const task: HeartbeatTask = {
      id: 'still-live',
      task: 'Keep running.',
      enabled: true,
      schedule: { intervalMs: 60_000 },
    };
    await firstStore.saveTask(task);
    const execution = {
      executionId: 'live-execution',
      ownerId: 'live-worker',
      claimedAt: NOW.toISOString(),
    };

    await expect(firstStore.claimTaskExecution({
      taskId: task.id,
      execution,
      loadedCheckpoint: false,
      claimedAt: NOW,
    })).resolves.toMatchObject({ status: 'claimed' });
    await expect(secondStore.recoverInterruptedTasks({
      ownerId: 'different-worker',
      recoveredAt: NOW,
      reason: 'host-restart',
    })).resolves.toEqual([]);
    await expect(secondStore.claimTaskExecution({
      taskId: task.id,
      execution: { ...execution, executionId: 'competing-execution' },
      loadedCheckpoint: false,
      claimedAt: NOW,
    })).resolves.toEqual({ status: 'busy' });
  });

  it('fences a late completion after recovery and a replacement claim', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'heddle-heartbeat-fence-'));
    const store = new FileHeartbeatTaskService({ dir });
    const originalExecution = {
      executionId: 'old-execution',
      ownerId: 'old-worker',
      claimedAt: '2026-04-12T23:50:00.000Z',
    };
    const interruptedTask: HeartbeatTask = {
      id: 'fenced-task',
      task: 'Fence late result.',
      enabled: true,
      schedule: { intervalMs: 60_000 },
      state: {
        status: 'running',
        resumable: true,
        execution: originalExecution,
      },
    };
    await store.saveTask(interruptedTask);
    await store.recoverInterruptedTasks({
      ownerId: 'replacement-worker',
      recoveredAt: NOW,
      reason: 'host-restart',
    });
    const replacementExecution = {
      executionId: 'replacement-execution',
      ownerId: 'replacement-worker',
      claimedAt: NOW.toISOString(),
    };
    const replacementClaim = await store.claimTaskExecution({
      taskId: interruptedTask.id,
      execution: replacementExecution,
      loadedCheckpoint: false,
      claimedAt: NOW,
    });
    expect(replacementClaim.status).toBe('claimed');

    const lateResult = createHeartbeatResult('continue');
    const lateTask = HeartbeatTaskStateProjector.afterResult({
      task: interruptedTask,
      result: lateResult,
      now: NOW,
      loadedCheckpoint: false,
    });
    await expect(store.completeTaskExecution({
      execution: originalExecution,
      task: lateTask,
      checkpoint: lateResult.checkpoint,
      result: lateResult,
      loadedCheckpoint: false,
    })).resolves.toEqual({ status: 'claim-lost' });
    await expect(store.requireTask(interruptedTask.id)).resolves.toMatchObject({
      state: {
        status: 'running',
        execution: replacementExecution,
      },
    });
    await expect(store.listRunRecords()).resolves.toEqual([]);
  });
});

function createMemoryTaskStore(options: {
  tasks: HeartbeatTask[];
  saveTask?: (task: HeartbeatTask) => void;
  saveCheckpoint?: (checkpoint: AgentLoopCheckpoint) => void;
}): HeartbeatTaskStore {
  let tasks = [...options.tasks];
  return {
    async listTasks() {
      return tasks;
    },
    async saveTask(task) {
      tasks = [...tasks.filter((candidate) => candidate.id !== task.id), task];
      options.saveTask?.(task);
    },
    async loadCheckpoint() {
      return undefined;
    },
    async saveCheckpoint(_task, checkpoint) {
      options.saveCheckpoint?.(checkpoint);
    },
    async claimTaskExecution(input) {
      const task = tasks.find((candidate) => candidate.id === input.taskId);
      if (!task) return { status: 'not-found' };
      if (!task.enabled) return { status: 'disabled' };
      if (task.state?.status === 'running') return { status: 'busy' };
      const runningTask = HeartbeatTaskStateProjector.markRunning({
        task,
        now: input.claimedAt,
        loadedCheckpoint: input.loadedCheckpoint,
        execution: input.execution,
      });
      tasks = [...tasks.filter((candidate) => candidate.id !== task.id), runningTask];
      options.saveTask?.(runningTask);
      return { status: 'claimed', task: runningTask };
    },
    async completeTaskExecution(input) {
      const task = tasks.find((candidate) => candidate.id === input.task.id);
      if (task?.state?.execution?.executionId !== input.execution.executionId) {
        return { status: 'claim-lost' };
      }
      const record = { task: input.task, result: input.result, loadedCheckpoint: input.loadedCheckpoint };
      tasks = [...tasks.filter((candidate) => candidate.id !== input.task.id), input.task];
      options.saveTask?.(input.task);
      options.saveCheckpoint?.(input.checkpoint);
      return { status: 'saved', task: input.task, record };
    },
    async failTaskExecution(input) {
      const task = tasks.find((candidate) => candidate.id === input.task.id);
      if (task?.state?.execution?.executionId !== input.execution.executionId) {
        return { status: 'claim-lost' };
      }
      tasks = [...tasks.filter((candidate) => candidate.id !== input.task.id), input.task];
      options.saveTask?.(input.task);
      return { status: 'saved', task: input.task };
    },
    async recoverInterruptedTasks() {
      return [];
    },
  };
}

function createHeartbeatResult(decision: AgentHeartbeatResult['decision']): AgentHeartbeatResult {
  const summary = `Heartbeat result.\n\nHEARTBEAT_DECISION: ${decision}`;
  const state = {
    status: 'finished' as const,
    runId: `run-${decision}`,
    goal: 'Heartbeat runner cycle.',
    model: 'gpt-test',
    provider: 'openai' as const,
    workspaceRoot: '/tmp/project',
    startedAt: '2026-04-13T00:00:00.000Z',
    finishedAt: '2026-04-13T00:00:01.000Z',
    outcome: 'done' as const,
    summary,
    transcript: [],
    trace: [],
  };

  return {
    decision,
    summary,
    state,
    checkpoint: AgentLoopCheckpointService.createCheckpoint(state, {
      createdAt: '2026-04-13T00:00:01.000Z',
    }),
  };
}
