import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { FileHeartbeatTaskRepository, type HeartbeatTask } from '../../../index.js';
import { RuntimeWorkspaceService } from '@/core/runtime/workspaces/index.js';
import { controlPlaneRouter } from '../../../server/features/control-plane/router.js';
import { ControlPlaneHeartbeatController } from '../../../server/features/control-plane/controllers/heartbeat.js';
import type { AgentHeartbeatResult } from '@/core/heartbeat/index.js';

function createTask(partial: Partial<HeartbeatTask> = {}): HeartbeatTask {
  return {
    id: 'repo-check',
    task: 'Inspect repo state and summarize changes.',
    enabled: true,
    schedule: {
      intervalMs: 60_000,
      nextRunAt: '2026-04-21T00:00:00.000Z',
    },
    state: {
      status: 'waiting',
      resumable: true,
    },
    ...partial,
  };
}

describe('control-plane heartbeat mutations', () => {
  it('creates heartbeat tasks through the control-plane controller', async () => {
    const stateRoot = mkdtempSync(join(tmpdir(), 'heddle-cp-heartbeat-create-'));

    const created = await ControlPlaneHeartbeatController.createTask(stateRoot, {
      workspaceId: 'workspace-1',
      name: 'Recent repo changes',
      task: 'Show me recent repo changes.',
      intervalMs: 60_000,
      enabled: true,
      defer: true,
      model: 'gpt-5.4',
      workspaceRoot: '/workspace',
      stateDir: '.heddle',
    });

    expect(created).toMatchObject({
      taskId: 'recent-repo-changes',
      workspaceId: 'workspace-1',
      name: 'Recent repo changes',
      task: 'Show me recent repo changes.',
      enabled: true,
      status: 'waiting',
      intervalMs: 60_000,
      model: 'gpt-5.4',
    });
  });

  it('runs one heartbeat task immediately through the scheduler path', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-cp-heartbeat-run-now-workspace-'));
    const stateRoot = mkdtempSync(join(tmpdir(), 'heddle-cp-heartbeat-run-now-'));
    const store = new FileHeartbeatTaskRepository({ dir: join(stateRoot, 'heartbeat') });
    await store.saveTask(createTask({
      schedule: {
        intervalMs: 60_000,
        nextRunAt: '2099-04-21T00:00:00.000Z',
      },
    }));

    const result = await ControlPlaneHeartbeatController.runTaskNow(stateRoot, {
      taskId: 'repo-check',
      workspaceRoot,
      stateDir: stateRoot,
      runner: async (): Promise<AgentHeartbeatResult> => createHeartbeatResult(workspaceRoot, 'run_now_1', 'Run now completed.'),
    });

    expect(result).toMatchObject({
      checked: 1,
      ran: 1,
      failed: 0,
      task: {
        taskId: 'repo-check',
        status: 'waiting',
        summary: 'Run now completed.',
      },
      run: {
        taskId: 'repo-check',
        runId: 'run_now_1',
        summary: 'Run now completed.',
      },
    });
    expect(await store.listRunRecords({ taskId: 'repo-check' })).toHaveLength(1);
  });

  it('enables and disables heartbeat tasks through service helpers', async () => {
    const stateRoot = mkdtempSync(join(tmpdir(), 'heddle-cp-heartbeat-enable-'));
    const store = new FileHeartbeatTaskRepository({ dir: join(stateRoot, 'heartbeat') });
    await store.saveTask(createTask());

    const disabled = await ControlPlaneHeartbeatController.setTaskEnabled(stateRoot, 'repo-check', false);
    expect(disabled).toMatchObject({ taskId: 'repo-check', enabled: false, status: 'idle' });
    expect(disabled.nextRunAt).toBeUndefined();

    const enabled = await ControlPlaneHeartbeatController.setTaskEnabled(stateRoot, 'repo-check', true);
    expect(enabled).toMatchObject({ taskId: 'repo-check', enabled: true });
    expect(enabled.nextRunAt).toBeTruthy();

    const views = await ControlPlaneHeartbeatController.listTasks(stateRoot);
    expect(views[0]).toMatchObject({ taskId: 'repo-check', enabled: true });
  });

  it('queues run-now when enabled and rejects trigger while disabled', async () => {
    const stateRoot = mkdtempSync(join(tmpdir(), 'heddle-cp-heartbeat-trigger-'));
    const store = new FileHeartbeatTaskRepository({ dir: join(stateRoot, 'heartbeat') });
    await store.saveTask(createTask({
      enabled: false,
      schedule: { intervalMs: 60_000, nextRunAt: undefined },
      state: { status: 'idle', resumable: true },
    }));

    await expect(ControlPlaneHeartbeatController.triggerTaskRun(stateRoot, 'repo-check')).rejects.toThrow(/disabled/i);

    await ControlPlaneHeartbeatController.setTaskEnabled(stateRoot, 'repo-check', true);
    const triggered = await ControlPlaneHeartbeatController.triggerTaskRun(stateRoot, 'repo-check');
    expect(triggered).toMatchObject({ taskId: 'repo-check', enabled: true, status: 'waiting' });
    expect(triggered.nextRunAt).toBeTruthy();

    const task = (await store.listTasks())[0];
    expect(task?.schedule.nextRunAt).toBeTruthy();
    expect(Date.parse(task?.schedule.nextRunAt ?? '')).toBeLessThanOrEqual(Date.now());
  });

  it('exposes heartbeat mutation procedures on the control-plane router', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-cp-heartbeat-workspace-'));
    const stateRoot = mkdtempSync(join(tmpdir(), 'heddle-cp-heartbeat-router-'));
    const store = new FileHeartbeatTaskRepository({ dir: join(stateRoot, 'heartbeat') });
    await store.saveTask(createTask());
    const catalog = RuntimeWorkspaceService.ensureCatalog({ workspaceRoot, stateRoot });
    const activeWorkspace = catalog.workspaces[0];
    if (!activeWorkspace) {
      throw new Error('expected default workspace');
    }

    const caller = controlPlaneRouter.createCaller({
      workspaceRoot,
      stateRoot,
      activeWorkspaceId: activeWorkspace.id,
      activeWorkspace,
      workspaces: catalog.workspaces,
      runtimeHost: null,
      logger: pino({ level: 'silent' }),
    });

    const paused = await caller.heartbeatTaskDisable({ taskId: 'repo-check' });
    expect(paused.task).toMatchObject({ taskId: 'repo-check', enabled: false });

    const resumed = await caller.heartbeatTaskEnable({ taskId: 'repo-check' });
    expect(resumed.task).toMatchObject({ taskId: 'repo-check', enabled: true });

    const triggered = await caller.heartbeatTaskTrigger({ taskId: 'repo-check' });
    expect(triggered.task).toMatchObject({ taskId: 'repo-check', enabled: true, status: 'waiting' });

    const created = await caller.heartbeatTaskCreate({
      id: 'router-created',
      name: 'Router created',
      task: 'Run from router.',
      intervalMs: 60_000,
    });
    expect(created.task).toMatchObject({ taskId: 'router-created', task: 'Run from router.', enabled: true });
  });

  it('exposes task detail and run detail through dedicated router procedures', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-cp-heartbeat-detail-workspace-'));
    const stateRoot = mkdtempSync(join(tmpdir(), 'heddle-cp-heartbeat-detail-router-'));
    const store = new FileHeartbeatTaskRepository({ dir: join(stateRoot, 'heartbeat') });
    const task = createTask({
      state: {
        status: 'complete',
        runAt: '2026-04-14T00:00:00.000Z',
        runId: 'run_heartbeat_1',
        resumable: true,
      },
    });
    await store.saveTask(task);
    await store.saveRunRecord({
      task,
      loadedCheckpoint: true,
      result: {
        decision: 'continue',
        summary: 'Heartbeat detail completed.',
        checkpoint: {
          version: 1,
          runId: 'run_heartbeat_1',
          createdAt: '2026-04-14T00:00:00.000Z',
          state: {
            status: 'finished',
            runId: 'run_heartbeat_1',
            goal: 'Heartbeat detail',
            model: 'gpt-5.4',
            provider: 'openai',
            workspaceRoot,
            startedAt: '2026-04-13T23:59:00.000Z',
            finishedAt: '2026-04-14T00:00:00.000Z',
            outcome: 'done',
            summary: 'Heartbeat detail completed.',
            transcript: [],
            trace: [],
          },
        },
        state: {
          status: 'finished',
          runId: 'run_heartbeat_1',
          goal: 'Heartbeat detail',
          model: 'gpt-5.4',
          provider: 'openai',
          workspaceRoot,
          startedAt: '2026-04-13T23:59:00.000Z',
          finishedAt: '2026-04-14T00:00:00.000Z',
          outcome: 'done',
          summary: 'Heartbeat detail completed.',
          transcript: [],
          trace: [],
        },
      },
    });
    const catalog = RuntimeWorkspaceService.ensureCatalog({ workspaceRoot, stateRoot });
    const activeWorkspace = catalog.workspaces[0];
    if (!activeWorkspace) {
      throw new Error('expected default workspace');
    }

    const caller = controlPlaneRouter.createCaller({
      workspaceRoot,
      stateRoot,
      activeWorkspaceId: activeWorkspace.id,
      activeWorkspace,
      workspaces: catalog.workspaces,
      runtimeHost: null,
      logger: pino({ level: 'silent' }),
    });

    const taskDetail = await caller.heartbeatTask({ taskId: 'repo-check' });
    expect(taskDetail.task).toMatchObject({ taskId: 'repo-check', status: 'complete' });
    expect(taskDetail.runs).toHaveLength(1);
    expect(taskDetail.runs[0]).toMatchObject({ runId: 'run_heartbeat_1', summary: 'Heartbeat detail completed.' });

    const runDetail = await caller.heartbeatRun({ taskId: 'repo-check', runId: 'run_heartbeat_1' });
    expect(runDetail.run).toMatchObject({ taskId: 'repo-check', runId: 'run_heartbeat_1', loadedCheckpoint: true });
  });
});

function createHeartbeatResult(
  workspaceRoot: string,
  runId: string,
  summary: string,
): AgentHeartbeatResult {
  return {
    decision: 'continue',
    summary,
    checkpoint: {
      version: 1,
      runId,
      createdAt: '2026-04-14T00:00:00.000Z',
      state: {
        status: 'finished',
        runId,
        goal: 'Heartbeat run now',
        model: 'gpt-5.4',
        provider: 'openai',
        workspaceRoot,
        startedAt: '2026-04-13T23:59:00.000Z',
        finishedAt: '2026-04-14T00:00:00.000Z',
        outcome: 'done',
        summary,
        transcript: [],
        trace: [],
      },
    },
    state: {
      status: 'finished',
      runId,
      goal: 'Heartbeat run now',
      model: 'gpt-5.4',
      provider: 'openai',
      workspaceRoot,
      startedAt: '2026-04-13T23:59:00.000Z',
      finishedAt: '2026-04-14T00:00:00.000Z',
      outcome: 'done',
      summary,
      transcript: [],
      trace: [],
    },
  };
}
