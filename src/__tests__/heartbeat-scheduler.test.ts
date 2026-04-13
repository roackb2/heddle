import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createAgentLoopCheckpoint,
  createFileHeartbeatTaskStore,
  runDueHeartbeatTasks,
  runHeartbeatScheduler,
  type HeartbeatSchedulerEvent,
  type HeartbeatTask,
  type HeartbeatTaskStore,
} from '../index.js';
import type { AgentHeartbeatResult } from '../runtime/heartbeat.js';
import type { AgentLoopCheckpoint } from '../runtime/events.js';

const NOW = new Date('2026-04-13T00:00:00.000Z');

describe('heartbeat scheduler', () => {
  it('runs due enabled tasks, persists checkpoints, and schedules the next wake', async () => {
    const events: HeartbeatSchedulerEvent[] = [];
    const task: HeartbeatTask = {
      id: 'project-maintenance',
      task: 'Maintain this project.',
      enabled: true,
      intervalMs: 5_000,
      nextRunAt: '2026-04-12T23:59:00.000Z',
    };
    let savedTask: HeartbeatTask | undefined;
    let savedCheckpoint: AgentLoopCheckpoint | undefined;
    const store: HeartbeatTaskStore = {
      async listTasks() {
        return [task];
      },
      async saveTask(nextTask) {
        savedTask = nextTask;
      },
      async loadCheckpoint() {
        return undefined;
      },
      async saveCheckpoint(_task, checkpoint) {
        savedCheckpoint = checkpoint;
      },
    };

    const result = await runDueHeartbeatTasks({
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
      nextRunAt: '2026-04-13T00:00:05.000Z',
      lastDecision: 'continue',
      lastOutcome: 'done',
    });
    expect(events.map((event) => event.type)).toEqual([
      'heartbeat.task.due',
      'heartbeat.task.started',
      'heartbeat.task.finished',
    ]);
  });

  it('disables terminal complete and escalate tasks after the wake cycle', async () => {
    const task: HeartbeatTask = {
      id: 'done-task',
      task: 'Finish this task.',
      enabled: true,
      intervalMs: 60_000,
    };
    let savedTask: HeartbeatTask | undefined;

    await runDueHeartbeatTasks({
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
      lastDecision: 'complete',
      nextRunAt: undefined,
    });
  });

  it('records failures and retries failed tasks later', async () => {
    const task: HeartbeatTask = {
      id: 'flaky-task',
      task: 'Try flaky work.',
      enabled: true,
      intervalMs: 60_000,
    };
    let savedTask: HeartbeatTask | undefined;
    const events: HeartbeatSchedulerEvent[] = [];

    const result = await runDueHeartbeatTasks({
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
      nextRunAt: '2026-04-13T00:00:10.000Z',
      lastError: 'temporary failure',
    });
    expect(events.at(-1)).toMatchObject({
      type: 'heartbeat.task.failed',
      taskId: 'flaky-task',
      error: 'temporary failure',
    });
  });

  it('stores tasks and checkpoints in a local heartbeat directory', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'heddle-heartbeat-scheduler-'));
    const store = createFileHeartbeatTaskStore({ dir });
    const task: HeartbeatTask = {
      id: 'local-task',
      task: 'Local task.',
      enabled: true,
      intervalMs: 60_000,
    };
    const checkpoint = createHeartbeatResult('pause').checkpoint;

    await store.saveTask(task);
    await store.saveCheckpoint(task, checkpoint);

    await expect(store.listTasks()).resolves.toEqual([task]);
    await expect(store.loadCheckpoint(task)).resolves.toMatchObject({
      version: 1,
      runId: checkpoint.runId,
    });
    expect(readFileSync(join(dir, 'tasks', 'local-task.json'), 'utf8')).toContain('Local task.');
  });

  it('runs the scheduler loop until aborted', async () => {
    const controller = new AbortController();
    const events: HeartbeatSchedulerEvent[] = [];
    let cycles = 0;

    await runHeartbeatScheduler({
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
});

function createMemoryTaskStore(options: {
  tasks: HeartbeatTask[];
  saveTask?: (task: HeartbeatTask) => void;
}): HeartbeatTaskStore {
  return {
    async listTasks() {
      return options.tasks;
    },
    async saveTask(task) {
      options.saveTask?.(task);
    },
    async loadCheckpoint() {
      return undefined;
    },
    async saveCheckpoint() {
      return undefined;
    },
  };
}

function createHeartbeatResult(decision: AgentHeartbeatResult['decision']): AgentHeartbeatResult {
  const summary = `Heartbeat result.\n\nHEARTBEAT_DECISION: ${decision}`;
  const state = {
    status: 'finished' as const,
    runId: `run-${decision}`,
    goal: 'Heartbeat wake cycle.',
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
    checkpoint: createAgentLoopCheckpoint(state, {
      createdAt: '2026-04-13T00:00:01.000Z',
    }),
  };
}
