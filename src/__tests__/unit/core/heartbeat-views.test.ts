import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FileHeartbeatTaskService,
  type AgentHeartbeatResult,
  type AgentLoopState,
  type HeartbeatTask,
  type HeartbeatTaskRunRecordEntry,
} from '../../../advanced.js';

describe('heartbeat task service views', () => {
  it('projects heartbeat task state into a host-facing view', () => {
    const service = new FileHeartbeatTaskService({ dir: '/tmp/heddle-heartbeat-view-test' });
    const view = service.projectTaskView({
      id: 'repo-check',
      workspaceId: 'workspace-1',
      task: 'Inspect repo state',
      enabled: true,
      schedule: {
        intervalMs: 60_000,
        nextRunAt: '2026-04-14T00:01:00.000Z',
      },
      state: {
        status: 'waiting',
        runAt: '2026-04-14T00:00:00.000Z',
        runId: 'run_1',
        loadedCheckpoint: true,
        resumable: true,
        progress: 'Heartbeat runner finished. Waiting until the next scheduled run in 1m.',
        result: createHeartbeatResult(),
      },
      runtime: {
        model: 'gpt-5.1-codex-mini',
      },
    });

    expect(view).toMatchObject({
      taskId: 'repo-check',
      workspaceId: 'workspace-1',
      task: 'Inspect repo state',
      enabled: true,
      schedule: {
        intervalMs: 60_000,
        nextRunAt: '2026-04-14T00:01:00.000Z',
      },
      runtime: {
        model: 'gpt-5.1-codex-mini',
      },
      state: {
        status: 'waiting',
        progress: 'Heartbeat runner finished. Waiting until the next scheduled run in 1m.',
        runAt: '2026-04-14T00:00:00.000Z',
        runId: 'run_1',
        loadedCheckpoint: true,
        resumable: true,
        result: {
          decision: 'continue',
          outcome: 'done',
          summary: 'Repository check complete.',
          usage: {
            inputTokens: 100,
            outputTokens: 20,
            totalTokens: 120,
            requests: 1,
          },
        },
      },
    });
  });

  it('projects heartbeat runs into a host-facing view', () => {
    const service = new FileHeartbeatTaskService({ dir: '/tmp/heddle-heartbeat-view-test' });
    const view = service.projectRunView(createRunEntry());

    expect(view).toMatchObject({
      id: 'run_1',
      taskId: 'repo-check',
      workspaceId: 'workspace-1',
      runId: 'run_1',
      createdAt: '2026-04-14T00:00:00.000Z',
      loadedCheckpoint: true,
      task: {
        taskId: 'repo-check',
        task: 'Inspect repo state',
        enabled: true,
        state: {
          status: 'waiting',
          progress: 'Heartbeat runner finished. Waiting until the next scheduled run in 1m.',
          resumable: true,
        },
      },
      result: {
        decision: 'continue',
        outcome: 'done',
        summary: 'Repository check complete.',
        usage: {
          inputTokens: 100,
          outputTokens: 20,
          totalTokens: 120,
          requests: 1,
        },
      },
    });
  });

  it('lists and loads projected views from a store', async () => {
    const task = createTask();
    const service = new FileHeartbeatTaskService({ dir: await mkdtemp(join(tmpdir(), 'heddle-heartbeat-views-')) });
    await service.saveTask(task);
    await service.saveRunRecord(createRunEntry().record);

    await expect(service.listTaskViews()).resolves.toMatchObject([
      {
        taskId: 'repo-check',
        state: {
          status: 'waiting',
        },
      },
    ]);
    await expect(service.listRunViews({ taskId: 'repo-check', limit: 1 })).resolves.toMatchObject([
      {
        taskId: 'repo-check',
        runId: 'run_1',
      },
    ]);
    await expect(service.readRun('repo-check', 'latest')).resolves.toMatchObject({
      taskId: 'repo-check',
      runId: 'run_1',
    });
  });

  it('lists task views newest last run first', async () => {
    const service = new FileHeartbeatTaskService({ dir: await mkdtemp(join(tmpdir(), 'heddle-heartbeat-task-order-')) });
    await service.saveTask(createTask({ id: 'older', runAt: '2026-04-14T00:00:00.000Z' }));
    await service.saveTask(createTask({ id: 'newer', runAt: '2026-04-14T00:10:00.000Z' }));
    await service.saveTask(createTask({ id: 'never-run', runAt: undefined }));

    await expect(service.listTaskViews()).resolves.toMatchObject([
      { taskId: 'newer' },
      { taskId: 'older' },
      { taskId: 'never-run' },
    ]);
  });
});

function createTask(options: { id?: string; runAt?: string } = {}): HeartbeatTask {
  const runAt = Object.hasOwn(options, 'runAt') ? options.runAt : '2026-04-14T00:00:00.000Z';
  return {
    id: options.id ?? 'repo-check',
    workspaceId: 'workspace-1',
    task: 'Inspect repo state',
    enabled: true,
    schedule: {
      intervalMs: 60_000,
      nextRunAt: '2026-04-14T00:01:00.000Z',
    },
    state: {
      status: 'waiting',
      runAt,
      runId: runAt === undefined ? undefined : 'run_1',
      loadedCheckpoint: true,
      resumable: true,
      progress: 'Heartbeat runner finished. Waiting until the next scheduled run in 1m.',
      result: createHeartbeatResult(),
    },
    runtime: {
      model: 'gpt-5.1-codex-mini',
    },
  };
}

function createRunEntry(): HeartbeatTaskRunRecordEntry {
  return {
    id: '2026-04-14T00-00-00.000Z-repo-check',
    path: '/tmp/2026-04-14T00-00-00.000Z-repo-check.json',
    taskId: 'repo-check',
    workspaceId: 'workspace-1',
    runId: 'run_1',
    createdAt: '2026-04-14T00:00:00.000Z',
    record: {
      task: createTask(),
      loadedCheckpoint: true,
      result: createHeartbeatResult(),
    },
  };
}

function createHeartbeatResult(): AgentHeartbeatResult {
  const state: AgentLoopState = {
    status: 'finished',
    runId: 'run_1',
    goal: 'Heartbeat runner cycle',
    model: 'gpt-5.1-codex-mini',
    provider: 'openai',
    workspaceRoot: '/tmp/workspace',
    startedAt: '2026-04-13T23:59:00.000Z',
    finishedAt: '2026-04-14T00:00:00.000Z',
    outcome: 'done',
    summary: 'Repository check complete.',
    usage: {
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
      requests: 1,
    },
    transcript: [],
    trace: [],
  };

  return {
    decision: 'continue',
    summary: 'Repository check complete.',
    checkpoint: {
      version: 1,
      runId: 'run_1',
      createdAt: '2026-04-14T00:00:00.000Z',
      state,
    },
    state,
  };
}
