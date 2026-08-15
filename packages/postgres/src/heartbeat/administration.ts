/** Atomic operator-facing administration over the PostgreSQL task authority. */
import {
  HeartbeatTaskControlPolicy,
  HeartbeatTaskViewProjector,
  type HeartbeatTask,
  type HeartbeatTaskAdministrationService,
  type ListHeartbeatRunViewsOptions,
  type ReadHeartbeatTaskOptions,
  type ReconcileHeartbeatTasksInput,
  type ReconcileHeartbeatTasksResult,
  type UpdateHeartbeatTaskInput,
} from '@heddleagent/runtime/advanced';
import { HeartbeatPostgresContext } from './internal/context.js';
import type { PostgresHeartbeatTaskStore } from './store.js';

/**
 * Builds the administration port over the same namespace as the worker store.
 * Every mutation locks the latest row before applying Heddle's control policy.
 */
export function createPostgresHeartbeatTaskAdministration(
  context: HeartbeatPostgresContext,
  store: PostgresHeartbeatTaskStore,
): HeartbeatTaskAdministrationService {
  const requireTask = async (taskId: string): Promise<HeartbeatTask> => {
    const task = await store.loadTask(taskId);
    if (!task) {
      throw new Error(`Heartbeat task not found: ${taskId}`);
    }
    return task;
  };

  const updateStoredTask = async (
    taskId: string,
    update: (task: HeartbeatTask) => HeartbeatTask,
  ): Promise<HeartbeatTask> => await context.database.transaction(
    async (transaction) => {
      const row = await context.lockTask(transaction, taskId);
      if (!row) {
        throw new Error(`Heartbeat task not found: ${taskId}`);
      }
      const task = update(context.taskFromRow(row));
      await context.writeTask(transaction, task, {
        leaseExpiresAt: row.leaseExpiresAt,
      });
      return task;
    },
  );

  const administration: HeartbeatTaskAdministrationService = {
    async listTaskViews() {
      return HeartbeatTaskViewProjector.projectTasks(await store.listTasks());
    },

    async listRunViews(options: ListHeartbeatRunViewsOptions = {}) {
      return (await store.listRunRecords(options))
        .map((run) => HeartbeatTaskViewProjector.projectRun(run));
    },

    async createTask(input) {
      return await context.database.transaction(async (transaction) => {
        await context.lockTaskCatalog(transaction);
        const currentTasks = (await context.lockNamespaceTasks(transaction))
          .map((row) => context.taskFromRow(row));
        const task = HeartbeatTaskControlPolicy.createTask({
          input,
          existingTasks: currentTasks,
          now: context.nowDate(),
        });
        await context.insertTask(transaction, task);
        return HeartbeatTaskViewProjector.projectTask(task);
      });
    },

    async reconcileTasks(
      input: ReconcileHeartbeatTasksInput,
    ): Promise<ReconcileHeartbeatTasksResult> {
      return await context.database.transaction(async (transaction) => {
        await context.lockTaskCatalog(transaction);
        const currentTasks = (await context.lockNamespaceTasks(transaction))
          .map((row) => context.taskFromRow(row));
        const reconciliation = HeartbeatTaskControlPolicy.reconcileTasks({
          currentTasks,
          input,
        });

        for (const task of reconciliation.created) {
          await context.insertTask(transaction, task);
        }
        await context.deleteTasks(
          transaction,
          reconciliation.deleted.map((task) => task.id),
        );
        return reconciliation;
      });
    },

    async updateTask(taskId: string, input: UpdateHeartbeatTaskInput) {
      const task = await updateStoredTask(taskId, (currentTask) => (
        HeartbeatTaskControlPolicy.updateTask({
          task: currentTask,
          input,
          now: context.nowDate(),
        })
      ));
      return HeartbeatTaskViewProjector.projectTask(task);
    },

    async deleteTask(taskId: string) {
      const task = await context.database.transaction(async (transaction) => {
        const row = await context.lockTask(transaction, taskId);
        if (!row) {
          throw new Error(`Heartbeat task not found: ${taskId}`);
        }
        const currentTask = context.taskFromRow(row);
        HeartbeatTaskControlPolicy.assertTaskCanBeDeleted(currentTask);
        await context.deleteTasks(transaction, [taskId]);
        return currentTask;
      });
      return HeartbeatTaskViewProjector.projectTask(task);
    },

    async resumeTask(taskId: string) {
      const task = await updateStoredTask(taskId, (currentTask) => (
        HeartbeatTaskControlPolicy.resumeTask({
          task: currentTask,
          now: context.nowDate(),
        })
      ));
      return HeartbeatTaskViewProjector.projectTask(task);
    },

    async readTask(
      taskId: string,
      options: ReadHeartbeatTaskOptions = {},
    ) {
      const task = await requireTask(taskId);
      const runs = await administration.listRunViews({
        taskId,
        limit: options.runLimit ?? 50,
      });
      return {
        task: HeartbeatTaskViewProjector.projectTask(task),
        runs,
      };
    },

    async readRun(taskId: string, runId: string) {
      await requireTask(taskId);
      const run = runId === 'latest'
        ? (await store.listRunRecords({ taskId, limit: 1 }))[0]
        : await store.loadRunRecord(runId);
      return run?.taskId === taskId
        ? HeartbeatTaskViewProjector.projectRun(run)
        : undefined;
    },

    async setTaskEnabled(taskId: string, enabled: boolean) {
      const task = await updateStoredTask(taskId, (currentTask) => (
        HeartbeatTaskControlPolicy.setTaskEnabled({
          task: currentTask,
          enabled,
          now: context.nowDate(),
        })
      ));
      return HeartbeatTaskViewProjector.projectTask(task);
    },

    async triggerTaskRun(taskId: string) {
      const result = await store.requestTaskRun(taskId, {
        reason: 'manual-trigger',
      });
      return HeartbeatTaskViewProjector.projectTask(result.task);
    },
  };

  return Object.freeze(administration);
}
