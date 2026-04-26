import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { createFileHeartbeatTaskStore, type HeartbeatTask } from '../../index.js';
import { ensureWorkspaceCatalog } from '../../core/runtime/workspaces.js';
import { controlPlaneRouter } from '../../server/features/control-plane/router.js';
import {
  listControlPlaneHeartbeatTasks,
  setControlPlaneHeartbeatTaskEnabled,
  triggerControlPlaneHeartbeatTaskRun,
} from '../../server/features/control-plane/services/heartbeat.js';

function createTask(partial: Partial<HeartbeatTask> = {}): HeartbeatTask {
  return {
    id: 'repo-check',
    task: 'Inspect repo state and summarize changes.',
    enabled: true,
    intervalMs: 60_000,
    status: 'waiting',
    nextRunAt: '2026-04-21T00:00:00.000Z',
    ...partial,
  };
}

describe('control-plane heartbeat mutations', () => {
  it('enables and disables heartbeat tasks through service helpers', async () => {
    const stateRoot = mkdtempSync(join(tmpdir(), 'heddle-cp-heartbeat-enable-'));
    const store = createFileHeartbeatTaskStore({ dir: join(stateRoot, 'heartbeat') });
    await store.saveTask(createTask());

    const disabled = await setControlPlaneHeartbeatTaskEnabled(stateRoot, 'repo-check', false);
    expect(disabled).toMatchObject({ taskId: 'repo-check', enabled: false, status: 'idle' });
    expect(disabled.nextRunAt).toBeUndefined();

    const enabled = await setControlPlaneHeartbeatTaskEnabled(stateRoot, 'repo-check', true);
    expect(enabled).toMatchObject({ taskId: 'repo-check', enabled: true });
    expect(enabled.nextRunAt).toBeTruthy();

    const views = await listControlPlaneHeartbeatTasks(stateRoot);
    expect(views[0]).toMatchObject({ taskId: 'repo-check', enabled: true });
  });

  it('queues run-now when enabled and rejects trigger while disabled', async () => {
    const stateRoot = mkdtempSync(join(tmpdir(), 'heddle-cp-heartbeat-trigger-'));
    const store = createFileHeartbeatTaskStore({ dir: join(stateRoot, 'heartbeat') });
    await store.saveTask(createTask({ enabled: false, status: 'idle', nextRunAt: undefined }));

    await expect(triggerControlPlaneHeartbeatTaskRun(stateRoot, 'repo-check')).rejects.toThrow(/disabled/i);

    await setControlPlaneHeartbeatTaskEnabled(stateRoot, 'repo-check', true);
    const triggered = await triggerControlPlaneHeartbeatTaskRun(stateRoot, 'repo-check');
    expect(triggered).toMatchObject({ taskId: 'repo-check', enabled: true, status: 'waiting' });
    expect(triggered.nextRunAt).toBeTruthy();

    const task = (await store.listTasks())[0];
    expect(task.nextRunAt).toBeTruthy();
    expect(Date.parse(task.nextRunAt ?? '')).toBeLessThanOrEqual(Date.now());
  });

  it('exposes heartbeat mutation procedures on the control-plane router', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-cp-heartbeat-workspace-'));
    const stateRoot = mkdtempSync(join(tmpdir(), 'heddle-cp-heartbeat-router-'));
    const store = createFileHeartbeatTaskStore({ dir: join(stateRoot, 'heartbeat') });
    await store.saveTask(createTask());
    const catalog = ensureWorkspaceCatalog({ workspaceRoot, stateRoot });
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
  });
});
