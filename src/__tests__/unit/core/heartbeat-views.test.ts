import { describe, expect, it } from 'vitest';
import {
  HeartbeatViewsPresenter,
  type AgentHeartbeatResult,
  type AgentLoopState,
  type HeartbeatTask,
  type HeartbeatTaskRunRecordEntry,
  type HeartbeatTaskStore,
} from '../../../index.js';

describe('heartbeat views', () => {
  it('projects heartbeat task state into a host-facing view', () => {
    const view = HeartbeatViewsPresenter.projectTask({
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
        progress: 'Heartbeat wake finished. Waiting until the next scheduled run in 1m.',
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
      status: 'waiting',
      decision: 'continue',
      outcome: 'done',
      progress: 'Heartbeat wake finished. Waiting until the next scheduled run in 1m.',
      summary: 'Repository check complete.',
      nextRunAt: '2026-04-14T00:01:00.000Z',
      lastRunAt: '2026-04-14T00:00:00.000Z',
      lastRunId: 'run_1',
      loadedCheckpoint: true,
      resumable: true,
      usage: {
        inputTokens: 100,
        outputTokens: 20,
        totalTokens: 120,
        requests: 1,
      },
      intervalMs: 60_000,
      model: 'gpt-5.1-codex-mini',
    });
  });

  it('projects heartbeat runs into a host-facing view', () => {
    const view = HeartbeatViewsPresenter.projectRun(createRunEntry());

    expect(view).toMatchObject({
      id: '2026-04-14T00-00-00.000Z-repo-check',
      taskId: 'repo-check',
      workspaceId: 'workspace-1',
      runId: 'run_1',
      createdAt: '2026-04-14T00:00:00.000Z',
      task: 'Inspect repo state',
      enabled: true,
      status: 'waiting',
      decision: 'continue',
      outcome: 'done',
      progress: 'Heartbeat wake finished. Waiting until the next scheduled run in 1m.',
      summary: 'Repository check complete.',
      loadedCheckpoint: true,
      resumable: true,
      usage: {
        inputTokens: 100,
        outputTokens: 20,
        totalTokens: 120,
        requests: 1,
      },
    });
  });

  it('lists and loads projected views from a store', async () => {
    const task = createTask();
    const run = createRunEntry();
    const store: HeartbeatTaskStore = {
      async listTasks() {
        return [task];
      },
      async saveTask() {
        return undefined;
      },
      async loadCheckpoint() {
        return undefined;
      },
      async saveCheckpoint() {
        return undefined;
      },
      async listRunRecords() {
        return [run];
      },
      async loadRunRecord(id) {
        return id === 'latest' ? undefined : run;
      },
    };

    await expect(HeartbeatViewsPresenter.listTaskViews(store)).resolves.toMatchObject([
      {
        taskId: 'repo-check',
        status: 'waiting',
      },
    ]);
    await expect(HeartbeatViewsPresenter.listRunViews(store, { taskId: 'repo-check', limit: 1 })).resolves.toMatchObject([
      {
        taskId: 'repo-check',
        runId: 'run_1',
      },
    ]);
    await expect(HeartbeatViewsPresenter.loadRunView(store, 'latest', { taskId: 'repo-check' })).resolves.toMatchObject({
      taskId: 'repo-check',
      runId: 'run_1',
    });
  });
});

function createTask(): HeartbeatTask {
  return {
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
      progress: 'Heartbeat wake finished. Waiting until the next scheduled run in 1m.',
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
    goal: 'Heartbeat wake cycle',
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
