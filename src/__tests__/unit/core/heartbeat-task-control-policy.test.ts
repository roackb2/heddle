import { describe, expect, it } from 'vitest';
import {
  FileHeartbeatTaskService,
  HeartbeatTaskControlPolicy,
  type HeartbeatTask,
  type HeartbeatTaskAdmissionControl,
  type HeartbeatTaskAdministrationService,
} from '../../../advanced.js';

const NOW = new Date('2026-08-08T00:00:00.000Z');

describe('HeartbeatTaskControlPolicy', () => {
  it('creates deterministic task defaults without replacing an existing id', () => {
    const task = HeartbeatTaskControlPolicy.createTask({
      input: {
        name: 'Weekly Digest',
        admissionGroupId: 'publisher-a',
        task: '  Summarize the week.  ',
        intervalMs: 60_000,
        defer: false,
      },
      existingTasks: [createTask({ id: 'weekly-digest' })],
      now: NOW,
    });

    expect(task).toMatchObject({
      id: 'weekly-digest-2',
      name: 'Weekly Digest',
      admissionGroupId: 'publisher-a',
      task: 'Summarize the week.',
      enabled: true,
      continuationMode: 'operator',
      schedule: {
        intervalMs: 60_000,
        nextRunAt: '2026-08-07T23:59:59.000Z',
      },
      state: {
        status: 'waiting',
        updatedAt: NOW.toISOString(),
      },
    });
    expect(() => HeartbeatTaskControlPolicy.createTask({
      input: { id: 'weekly-digest', task: 'Replace it.' },
      existingTasks: [createTask({ id: 'weekly-digest' })],
      now: NOW,
    })).toThrow(/already exists/i);
    expect(() => HeartbeatTaskControlPolicy.createTask({
      input: { task: 'Invalid group.', admissionGroupId: '   ' },
      existingTasks: [],
      now: NOW,
    })).toThrow(/group id cannot be blank/i);
    expect(() => HeartbeatTaskControlPolicy.createTask({
      input: { task: 'Non-canonical group.', admissionGroupId: ' publisher-a ' },
      existingTasks: [],
      now: NOW,
    })).toThrow(/leading or trailing whitespace/i);
  });

  it('updates the latest running task without erasing its claim or pending request', () => {
    const running = createTask({
      id: 'representative-live',
      state: {
        status: 'running',
        execution: {
          executionId: 'execution-live',
          ownerId: 'worker-live',
          claimedAt: NOW.toISOString(),
          runRequestGeneration: 1,
        },
        runRequest: {
          generation: 2,
          claimedGeneration: 1,
          requestedAt: NOW.toISOString(),
        },
      },
    });

    const updated = HeartbeatTaskControlPolicy.updateTask({
      task: running,
      input: { name: 'Updated representative', intervalMs: 120_000 },
      now: NOW,
    });
    expect(updated).toMatchObject({
      name: 'Updated representative',
      enabled: true,
      schedule: {
        intervalMs: 120_000,
        nextRunAt: running.schedule.nextRunAt,
      },
      state: {
        status: 'running',
        execution: { executionId: 'execution-live' },
        runRequest: { generation: 2, claimedGeneration: 1 },
      },
    });

    const disabled = HeartbeatTaskControlPolicy.updateTask({
      task: updated,
      input: { enabled: false },
      now: NOW,
    });
    expect(disabled.schedule.nextRunAt).toBeUndefined();
    expect(disabled.state?.execution?.executionId).toBe('execution-live');
    expect(disabled.state?.runRequest).toMatchObject({ generation: 2, claimedGeneration: 2 });

    const grouped = HeartbeatTaskControlPolicy.updateTask({
      task: updated,
      input: { admissionGroupId: 'publisher-b' },
      now: NOW,
    });
    expect(grouped.admissionGroupId).toBe('publisher-b');
    expect(HeartbeatTaskControlPolicy.updateTask({
      task: grouped,
      input: { admissionGroupId: null },
      now: NOW,
    }).admissionGroupId).toBeUndefined();
  });

  it('projects pause and resume semantics including blocked-task protection', () => {
    const pending = createTask({
      state: {
        status: 'waiting',
        runRequest: {
          generation: 3,
          claimedGeneration: 2,
          requestedAt: NOW.toISOString(),
        },
      },
    });
    const paused = HeartbeatTaskControlPolicy.setTaskEnabled({ task: pending, enabled: false, now: NOW });
    expect(paused).toMatchObject({
      enabled: false,
      schedule: { nextRunAt: undefined },
      state: {
        status: 'idle',
        progress: 'Heartbeat task paused by operator.',
        runRequest: { generation: 3, claimedGeneration: 3 },
      },
    });

    const blocked = createTask({
      enabled: false,
      schedule: { intervalMs: 60_000, nextRunAt: undefined },
      state: { status: 'blocked', resumable: true, error: 'Needs review.' },
    });
    expect(() => HeartbeatTaskControlPolicy.setTaskEnabled({ task: blocked, enabled: true, now: NOW }))
      .toThrow(/use resume/i);

    const resumed = HeartbeatTaskControlPolicy.resumeTask({ task: blocked, now: NOW });
    expect(resumed).toMatchObject({
      enabled: true,
      schedule: { nextRunAt: '2026-08-07T23:59:59.000Z' },
      state: {
        status: 'waiting',
        progress: 'Heartbeat task resumed. Waiting for the next scheduler poll.',
      },
    });
    expect(resumed.state?.error).toBeUndefined();
  });

  it('plans namespace reconciliation while preserving running tasks', () => {
    const live = createTask({
      id: 'representative-live',
      state: {
        status: 'running',
        execution: {
          executionId: 'execution-live',
          ownerId: 'worker-live',
          claimedAt: NOW.toISOString(),
        },
      },
    });
    const obsolete = createTask({ id: 'representative-obsolete' });
    const outside = createTask({ id: 'outside' });
    const replacement = createTask({ id: 'representative-live', task: 'Do not overwrite live state.' });
    const added = createTask({ id: 'representative-new' });

    const reconciliation = HeartbeatTaskControlPolicy.reconcileTasks({
      currentTasks: [live, obsolete, outside],
      input: { namespace: 'representative-', desired: [replacement, added] },
    });
    expect(reconciliation.created).toEqual([added]);
    expect(reconciliation.updated).toEqual([]);
    expect(reconciliation.deleted).toEqual([obsolete]);
    expect(reconciliation.preservedRunning).toEqual([live]);
    expect(() => HeartbeatTaskControlPolicy.assertTaskCanBeDeleted(live)).toThrow(/running/i);
    expect(() => HeartbeatTaskControlPolicy.reconcileTasks({
      currentTasks: [],
      input: { namespace: 'representative-', desired: [outside] },
    })).toThrow(/must start with namespace/i);
    expect(() => HeartbeatTaskControlPolicy.reconcileTasks({
      currentTasks: [],
      input: {
        namespace: 'representative-',
        desired: [],
        existingTaskPolicy: 'replace-state' as never,
      },
    })).toThrow(/unsupported existing heartbeat task policy/i);
  });

  it('synchronizes code-owned configuration without replacing durable execution state', () => {
    const current = createTask({
      id: 'managed-task',
      workspaceId: 'durable-workspace',
      checkpointPath: '/durable/checkpoint.json',
      name: 'Old name',
      admissionGroupId: 'old-group',
      task: 'Old instructions.',
      continuationMode: 'operator',
      schedule: {
        intervalMs: 60_000,
        nextRunAt: '2026-08-08T05:00:00.000Z',
      },
      runtime: {
        model: 'old-model',
        maxSteps: 2,
        workspaceRoot: '/durable/workspace',
        stateDir: '/durable/state',
        memoryDir: '/durable/memory',
        searchIgnoreDirs: ['old-ignore'],
        systemContext: 'Old context.',
      },
      state: {
        status: 'running',
        execution: {
          executionId: 'execution-live',
          ownerId: 'worker-live',
          claimedAt: NOW.toISOString(),
        },
        runRequest: {
          generation: 2,
          claimedGeneration: 1,
          requestedAt: NOW.toISOString(),
        },
        lastExecution: {
          kind: 'skipped',
          executionId: 'execution-previous',
          summary: 'Previous durable outcome.',
          finishedAt: NOW.toISOString(),
        },
      },
    });
    const desired = createTask({
      id: current.id,
      workspaceId: 'ignored-workspace',
      checkpointPath: '/ignored/checkpoint.json',
      name: 'Managed name',
      admissionGroupId: 'managed-group',
      task: '  Managed instructions.  ',
      continuationMode: 'agent',
      schedule: {
        intervalMs: 120_000,
        nextRunAt: '2099-01-01T00:00:00.000Z',
      },
      runtime: {
        model: 'managed-model',
        maxSteps: 4,
        workspaceRoot: '/ignored/workspace',
        stateDir: '/ignored/state',
        memoryDir: '/ignored/memory',
        searchIgnoreDirs: ['managed-ignore'],
        systemContext: 'Managed context.',
      },
      state: { status: 'idle' },
    });

    const reconciliation = HeartbeatTaskControlPolicy.reconcileTasks({
      currentTasks: [current],
      input: {
        namespace: 'managed-',
        desired: [desired],
        existingTaskPolicy: 'synchronize-configuration',
      },
      now: NOW,
    });

    expect(reconciliation.updated).toHaveLength(1);
    expect(reconciliation.updated[0]).toMatchObject({
      id: current.id,
      workspaceId: current.workspaceId,
      checkpointPath: current.checkpointPath,
      name: desired.name,
      admissionGroupId: desired.admissionGroupId,
      task: 'Managed instructions.',
      enabled: true,
      continuationMode: 'agent',
      schedule: {
        intervalMs: desired.schedule.intervalMs,
        nextRunAt: current.schedule.nextRunAt,
      },
      runtime: {
        model: desired.runtime?.model,
        maxSteps: desired.runtime?.maxSteps,
        workspaceRoot: current.runtime?.workspaceRoot,
        stateDir: current.runtime?.stateDir,
        memoryDir: current.runtime?.memoryDir,
        searchIgnoreDirs: desired.runtime?.searchIgnoreDirs,
        systemContext: desired.runtime?.systemContext,
      },
      state: {
        status: 'running',
        execution: current.state?.execution,
        runRequest: current.state?.runRequest,
        lastExecution: current.state?.lastExecution,
        updatedAt: NOW.toISOString(),
      },
    });
    expect(reconciliation.preservedRunning).toEqual(reconciliation.updated);
    expect(current.name).toBe('Old name');

    expect(() => HeartbeatTaskControlPolicy.reconcileTasks({
      currentTasks: [current],
      input: {
        namespace: 'managed-',
        desired: [desired],
        existingTaskPolicy: 'synchronize-configuration',
      },
    })).toThrow(/requires a current timestamp/i);

    expect(HeartbeatTaskControlPolicy.reconcileTasks({
      currentTasks: reconciliation.updated,
      input: {
        namespace: 'managed-',
        desired: [desired],
        existingTaskPolicy: 'synchronize-configuration',
      },
      now: new Date(NOW.getTime() + 60_000),
    }).updated).toEqual([]);
  });

  it('uses normal enablement safety when synchronizing code-owned configuration', () => {
    const disabled = createTask({
      id: 'managed-disabled',
      enabled: false,
      schedule: { intervalMs: 60_000 },
      state: { status: 'idle' },
    });
    const enabled = HeartbeatTaskControlPolicy.reconcileTasks({
      currentTasks: [disabled],
      input: {
        namespace: 'managed-',
        desired: [{ ...disabled, enabled: true }],
        existingTaskPolicy: 'synchronize-configuration',
      },
      now: NOW,
    }).updated[0];

    expect(enabled).toMatchObject({
      enabled: true,
      schedule: { nextRunAt: '2026-08-07T23:59:59.000Z' },
      state: { status: 'waiting' },
    });

    const blocked = {
      ...disabled,
      id: 'managed-blocked',
      state: { status: 'blocked' as const, resumable: true },
    };
    expect(() => HeartbeatTaskControlPolicy.reconcileTasks({
      currentTasks: [blocked],
      input: {
        namespace: 'managed-',
        desired: [{ ...blocked, enabled: true }],
        existingTaskPolicy: 'synchronize-configuration',
      },
      now: NOW,
    })).toThrow(/blocked.*resume/i);
  });

  it('validates and projects a durable run request for adapters', () => {
    const task = createTask();
    const requested = HeartbeatTaskControlPolicy.requestTaskRun({
      task,
      options: { reason: '  new-work  ', requestedAt: NOW },
      now: new Date('2099-01-01T00:00:00.000Z'),
    });

    expect(requested).toMatchObject({
      taskId: task.id,
      generation: 1,
      disposition: 'requested',
      requestedAt: NOW.toISOString(),
      reason: 'new-work',
      task: {
        state: { runRequest: { generation: 1, claimedGeneration: 0 } },
      },
    });
    expect(() => HeartbeatTaskControlPolicy.requestTaskRun({
      task: { ...task, enabled: false },
      now: NOW,
    })).toThrow(/disabled/i);
  });

  it('keeps the file service assignable to the public administration contract', () => {
    const service: HeartbeatTaskAdministrationService = new FileHeartbeatTaskService({
      dir: '/tmp/heddle-heartbeat-administration-contract',
    });
    const admission: HeartbeatTaskAdmissionControl = new FileHeartbeatTaskService({
      dir: '/tmp/heddle-heartbeat-admission-contract',
    });
    expect(service).toBeInstanceOf(FileHeartbeatTaskService);
    expect(admission).toBeInstanceOf(FileHeartbeatTaskService);
  });
});

function createTask(overrides: Partial<HeartbeatTask> = {}): HeartbeatTask {
  return {
    id: 'representative',
    task: 'Process representative work.',
    enabled: true,
    schedule: {
      intervalMs: 60_000,
      nextRunAt: '2026-08-08T00:01:00.000Z',
    },
    state: {
      status: 'waiting',
      resumable: true,
    },
    ...overrides,
  };
}
