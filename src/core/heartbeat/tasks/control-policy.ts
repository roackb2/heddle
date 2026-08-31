/**
 * Provider-neutral heartbeat task administration policy.
 *
 * These projections are intentionally persistence-free. File and remote
 * adapters must apply them to the latest durable task inside their own atomic
 * mutation boundary.
 */
import dayjs from 'dayjs';
import omit from 'lodash/omit.js';
import type {
  CreateHeartbeatTaskInput,
  ReconcileHeartbeatTasksInput,
  ReconcileHeartbeatTasksResult,
  UpdateHeartbeatTaskInput,
} from './administration.js';
import { HeartbeatTaskStateProjector } from './task-state.js';
import { MAX_HEARTBEAT_RUN_REQUEST_REASON_LENGTH } from './types.js';
import type {
  HeartbeatTask,
  HeartbeatTaskRunRequestResult,
  HeartbeatTaskState,
  RequestHeartbeatTaskRunOptions,
} from './types.js';

export class HeartbeatTaskControlPolicy {
  static createTask(args: {
    input: CreateHeartbeatTaskInput;
    existingTasks: readonly HeartbeatTask[];
    now: Date;
  }): HeartbeatTask {
    const now = HeartbeatTaskControlPolicy.requireValidDate(args.now, 'Heartbeat task creation timestamp');
    const existingIds = args.existingTasks.map((task) => task.id);
    const id = args.input.id ?? HeartbeatTaskControlPolicy.createTaskId(
      args.input.name ?? args.input.task,
      existingIds,
    );
    if (existingIds.includes(id)) {
      throw new Error(`Heartbeat task already exists: ${id}`);
    }

    const intervalMs = args.input.intervalMs ?? 60 * 60_000;
    return {
      id,
      workspaceId: args.input.workspaceId,
      name: args.input.name,
      admissionGroupId: HeartbeatTaskControlPolicy.resolveAdmissionGroupId(args.input.admissionGroupId),
      task: args.input.task.trim(),
      enabled: args.input.enabled ?? true,
      continuationMode: args.input.continuationMode ?? 'operator',
      schedule: {
        intervalMs,
        nextRunAt: (
          args.input.defer === false ? now.subtract(1, 'second') : now.add(intervalMs, 'millisecond')
        ).toISOString(),
      },
      runtime: {
        model: args.input.model,
        maxSteps: args.input.maxSteps,
        workspaceRoot: args.input.workspaceRoot,
        stateDir: args.input.stateDir,
        searchIgnoreDirs: args.input.searchIgnoreDirs,
        systemContext: args.input.systemContext,
      },
      state: {
        status: args.input.enabled === false ? 'idle' : 'waiting',
        updatedAt: now.toISOString(),
      },
    };
  }

  static updateTask(args: {
    task: HeartbeatTask;
    input: UpdateHeartbeatTaskInput;
    now: Date;
  }): HeartbeatTask {
    const now = HeartbeatTaskControlPolicy.requireValidDate(args.now, 'Heartbeat task update timestamp');
    const intervalMs = args.input.intervalMs ?? args.task.schedule.intervalMs;
    const running = args.task.state?.status === 'running';
    const enabled = args.input.enabled ?? args.task.enabled;
    const pendingRunRequest = HeartbeatTaskStateProjector.hasPendingRunRequest(args.task);

    return {
      ...args.task,
      name: args.input.name ?? args.task.name,
      admissionGroupId:
        args.input.admissionGroupId === undefined ? args.task.admissionGroupId
        : HeartbeatTaskControlPolicy.resolveAdmissionGroupId(args.input.admissionGroupId),
      task: args.input.task?.trim() ?? args.task.task,
      enabled,
      continuationMode: args.input.continuationMode ?? args.task.continuationMode ?? 'operator',
      schedule: {
        ...args.task.schedule,
        intervalMs,
        nextRunAt:
          !enabled ? undefined
          : running || pendingRunRequest ? args.task.schedule.nextRunAt
          : now.add(intervalMs, 'millisecond').toISOString(),
      },
      runtime: {
        ...args.task.runtime,
        model: args.input.model === undefined ? args.task.runtime?.model : args.input.model ?? undefined,
        maxSteps: args.input.maxSteps === undefined ? args.task.runtime?.maxSteps : args.input.maxSteps ?? undefined,
        searchIgnoreDirs: args.input.searchIgnoreDirs ?? args.task.runtime?.searchIgnoreDirs,
        systemContext: args.input.systemContext ?? args.task.runtime?.systemContext,
      },
      state: {
        ...args.task.state,
        runRequest:
          enabled ? args.task.state?.runRequest
          : HeartbeatTaskControlPolicy.consumePendingRunRequest(args.task.state?.runRequest),
        updatedAt: now.toISOString(),
      },
    };
  }

  static setTaskEnabled(args: {
    task: HeartbeatTask;
    enabled: boolean;
    now: Date;
  }): HeartbeatTask {
    const now = HeartbeatTaskControlPolicy.requireValidDate(args.now, 'Heartbeat task enablement timestamp');
    if (args.enabled && args.task.state?.status === 'blocked') {
      throw new Error(`Heartbeat task ${args.task.id} is blocked. Use resume to unblock it.`);
    }

    return {
      ...args.task,
      enabled: args.enabled,
      schedule: {
        ...args.task.schedule,
        nextRunAt:
          args.enabled ? args.task.schedule.nextRunAt ?? now.subtract(1, 'second').toISOString()
          : undefined,
      },
      state: {
        ...args.task.state,
        status: HeartbeatTaskControlPolicy.resolveEnabledStatus(args.task, args.enabled),
        progress: HeartbeatTaskControlPolicy.resolveEnabledProgress(args.task, args.enabled),
        resumable: args.enabled ? true : args.task.state?.resumable,
        runRequest:
          args.enabled ? args.task.state?.runRequest
          : HeartbeatTaskControlPolicy.consumePendingRunRequest(args.task.state?.runRequest),
        updatedAt: now.toISOString(),
      },
    };
  }

  static resumeTask(args: { task: HeartbeatTask; now: Date }): HeartbeatTask {
    const now = HeartbeatTaskControlPolicy.requireValidDate(args.now, 'Heartbeat task resume timestamp');
    if (args.task.state?.status === 'running') {
      throw new Error(`Heartbeat task ${args.task.id} is already running.`);
    }
    if (args.task.state?.resumable === false) {
      throw new Error(`Heartbeat task ${args.task.id} cannot be resumed.`);
    }

    return {
      ...args.task,
      enabled: true,
      schedule: {
        ...args.task.schedule,
        nextRunAt: now.subtract(1, 'second').toISOString(),
      },
      state: {
        ...omit(args.task.state, ['error']),
        status: 'waiting',
        progress: 'Heartbeat task resumed. Waiting for the next scheduler poll.',
        updatedAt: now.toISOString(),
      },
    };
  }

  static assertTaskCanBeDeleted(task: HeartbeatTask): void {
    if (task.state?.status === 'running') {
      throw new Error(`Heartbeat task ${task.id} is running. Wait for the run to finish before deleting it.`);
    }
  }

  static reconcileTasks(args: {
    currentTasks: readonly HeartbeatTask[];
    input: ReconcileHeartbeatTasksInput;
  }): ReconcileHeartbeatTasksResult {
    HeartbeatTaskControlPolicy.assertReconciliationInput(args.input);

    const currentById = new Map(args.currentTasks.map((task) => [task.id, task]));
    const desiredById = new Map(args.input.desired.map((task) => [task.id, task]));
    const namespaceTasks = args.currentTasks.filter((task) => task.id.startsWith(args.input.namespace));
    const created = [...desiredById.values()].filter((task) => !currentById.has(task.id));
    const obsolete = namespaceTasks.filter((task) => !desiredById.has(task.id));

    return {
      created,
      deleted: obsolete.filter((task) => task.state?.status !== 'running'),
      preservedRunning: namespaceTasks.filter((task) => task.state?.status === 'running'),
    };
  }

  static requestTaskRun(args: {
    task: HeartbeatTask;
    options?: RequestHeartbeatTaskRunOptions;
    now: Date;
  }): HeartbeatTaskRunRequestResult {
    const reason = HeartbeatTaskControlPolicy.normalizeRunRequestReason(args.options?.reason);
    const requestedAt = HeartbeatTaskControlPolicy.requireValidDate(
      args.options?.requestedAt ?? args.now,
      'Heartbeat run-request timestamp',
    ).toDate();
    HeartbeatTaskControlPolicy.assertTaskAcceptsRunRequest(args.task);
    const projection = HeartbeatTaskStateProjector.requestRun({
      task: args.task,
      now: requestedAt,
      reason,
    });
    const request = projection.task.state?.runRequest;
    if (!request) {
      throw new Error(`Heartbeat task ${args.task.id} did not project its run request.`);
    }

    return {
      task: projection.task,
      taskId: args.task.id,
      generation: request.generation,
      disposition: projection.disposition,
      requestedAt: request.requestedAt,
      reason: request.reason,
    };
  }

  private static assertTaskAcceptsRunRequest(task: HeartbeatTask): void {
    if (task.state?.status === 'blocked') {
      throw new Error(`Heartbeat task ${task.id} is blocked. Resume it before requesting a run.`);
    }
    if (task.state?.status === 'complete') {
      throw new Error(`Heartbeat task ${task.id} is complete. Resume it before requesting a run.`);
    }
    if (!task.enabled) {
      throw new Error(`Heartbeat task ${task.id} is disabled. Enable it before requesting a run.`);
    }
  }

  private static normalizeRunRequestReason(reason: string | undefined): string | undefined {
    if (reason === undefined) {
      return undefined;
    }

    const normalized = reason.trim();
    if (!normalized) {
      throw new Error('Heartbeat run-request reason cannot be empty.');
    }
    if (normalized.length > MAX_HEARTBEAT_RUN_REQUEST_REASON_LENGTH) {
      throw new Error(`Heartbeat run-request reason must be at most ${MAX_HEARTBEAT_RUN_REQUEST_REASON_LENGTH} characters.`);
    }
    return normalized;
  }

  private static assertReconciliationInput(input: ReconcileHeartbeatTasksInput): void {
    if (!input.namespace) {
      throw new Error('Heartbeat reconciliation namespace cannot be empty.');
    }

    const desiredIds = input.desired.map((task) => task.id);
    if (new Set(desiredIds).size !== desiredIds.length) {
      throw new Error(`Heartbeat reconciliation namespace ${input.namespace} contains duplicate task IDs.`);
    }
    if (desiredIds.some((taskId) => !taskId.startsWith(input.namespace))) {
      throw new Error(`Heartbeat reconciliation desired task IDs must start with namespace ${input.namespace}.`);
    }
  }

  private static consumePendingRunRequest(
    runRequest: HeartbeatTaskState['runRequest'],
  ): HeartbeatTaskState['runRequest'] {
    return runRequest ? {
      ...runRequest,
      claimedGeneration: runRequest.generation,
    } : undefined;
  }

  private static resolveEnabledStatus(
    task: HeartbeatTask,
    enabled: boolean,
  ): NonNullable<NonNullable<HeartbeatTask['state']>['status']> {
    if (task.state?.status === 'running') {
      return 'running';
    }
    if (!enabled && task.state?.status === 'blocked') {
      return 'blocked';
    }
    return enabled ? 'waiting' : 'idle';
  }

  private static resolveEnabledProgress(task: HeartbeatTask, enabled: boolean): string | undefined {
    if (task.state?.status === 'running' || task.state?.status === 'blocked') {
      return task.state.progress;
    }
    return enabled ?
      'Heartbeat task enabled. Waiting for the next scheduled run.'
    : 'Heartbeat task paused by operator.';
  }

  private static createTaskId(value: string, existingIds: readonly string[]): string {
    const base = value
      .toLowerCase()
      .replace(/[`'"]/g, '')
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64)
      .replace(/-+$/g, '') || 'heartbeat-task';
    if (!existingIds.includes(base)) {
      return base;
    }

    for (let index = 2; index < 1_000; index++) {
      const candidate = `${base}-${index}`;
      if (!existingIds.includes(candidate)) {
        return candidate;
      }
    }

    throw new Error(`Unable to create a unique heartbeat task id for ${base}`);
  }

  private static resolveAdmissionGroupId(value: string | null | undefined): string | undefined {
    if (value === null || value === undefined) {
      return undefined;
    }
    if (!value.trim()) {
      throw new Error('Heartbeat admission group id cannot be blank.');
    }
    return value;
  }

  private static requireValidDate(value: Date, label: string) {
    const date = dayjs(value);
    if (!date.isValid()) {
      throw new Error(`${label} must be a valid date.`);
    }
    return date;
  }
}
