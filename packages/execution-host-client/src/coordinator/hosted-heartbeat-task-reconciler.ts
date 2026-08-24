import {
  HostedHeartbeatDesiredTaskCatalogSchema,
} from './contracts.js';
import type {
  HostedHeartbeatTaskReconcilerConfig,
  HostedHeartbeatTaskReconciliation,
  HostedHeartbeatTaskReconciliationInput,
} from './types.js';

/**
 * Publishes one product's desired catalog while keeping admission paused until
 * every deletion and upsert has succeeded.
 */
export class HostedHeartbeatTaskReconciler {
  readonly #coordinator: HostedHeartbeatTaskReconcilerConfig['coordinator'];

  constructor(config: HostedHeartbeatTaskReconcilerConfig) {
    this.#coordinator = config.coordinator;
  }

  async reconcile(
    rawInput: HostedHeartbeatTaskReconciliationInput,
  ): Promise<HostedHeartbeatTaskReconciliation> {
    const input = HostedHeartbeatDesiredTaskCatalogSchema.parse({
      tasks: rawInput.desiredTasks,
      resume: rawInput.resume,
    });
    rawInput.signal?.throwIfAborted();
    await this.#coordinator.pause(rawInput.signal);
    const existingTasks = await this.#coordinator.listTasks(rawInput.signal);
    const desiredByTaskId = new Map(
      input.tasks.map((task) => [task.taskId, task]),
    );
    const deletedTaskIds = existingTasks
      .filter(({ id, workspaceId }) => {
        const desired = desiredByTaskId.get(id);
        return !desired || workspaceId !== desired.input.workspaceId;
      })
      .map(({ id }) => id);

    await Promise.all(deletedTaskIds.map((taskId) => (
      this.#coordinator.deleteTask(taskId, rawInput.signal)
    )));
    await Promise.all(input.tasks.map(({ taskId, input: task }) => (
      this.#coordinator.upsertTask(taskId, task, rawInput.signal)
    )));
    if (input.resume) {
      await this.#coordinator.resume(rawInput.signal);
    }

    return {
      deleted: deletedTaskIds.length,
      upserted: input.tasks.length,
      resumed: input.resume,
    };
  }
}
