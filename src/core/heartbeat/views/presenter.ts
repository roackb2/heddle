/**
 * Heartbeat views presenter.
 *
 * Projects durable task and run records into compact host-facing views. Keep
 * this projection here so CLI/server/web surfaces do not each reinterpret
 * heartbeat task state.
 */
import type { HeartbeatTask, HeartbeatTaskRunRecordEntry, HeartbeatTaskStore } from '../tasks/index.js';
import type { HeartbeatRunView, HeartbeatTaskView } from './types.js';

export class HeartbeatViewsPresenter {
  static async listTaskViews(store: HeartbeatTaskStore): Promise<HeartbeatTaskView[]> {
    return (await store.listTasks()).map((task) => HeartbeatViewsPresenter.projectTask(task));
  }

  static async listRunViews(
    store: HeartbeatTaskStore,
    options: { taskId?: string; limit?: number } = {},
  ): Promise<HeartbeatRunView[]> {
    const runs = await store.listRunRecords?.(options);
    return (runs ?? []).map((run) => HeartbeatViewsPresenter.projectRun(run));
  }

  static async loadRunView(
    store: HeartbeatTaskStore,
    id: string,
    options: { taskId?: string } = {},
  ): Promise<HeartbeatRunView | undefined> {
    const run =
      id === 'latest' ?
        (await store.listRunRecords?.({ taskId: options.taskId, limit: 1 }))?.[0]
      : await store.loadRunRecord?.(id);
    if (!run || (options.taskId && run.taskId !== options.taskId)) {
      return undefined;
    }
    return HeartbeatViewsPresenter.projectRun(run);
  }

  static projectTask(task: HeartbeatTask): HeartbeatTaskView {
    const result = task.state?.result;
    return {
      ...task,
      ...task.schedule,
      ...task.runtime,
      ...task.state,
      taskId: task.id,
      status: task.state?.status ?? 'idle',
      lastRunAt: task.state?.runAt,
      lastRunId: task.state?.runId,
      decision: result?.decision,
      summary: result?.summary,
      outcome: result?.state.outcome,
      usage: result?.state.usage,
    };
  }

  static projectRun(run: HeartbeatTaskRunRecordEntry): HeartbeatRunView {
    return {
      ...HeartbeatViewsPresenter.projectTask(run.record.task),
      ...run,
      id: run.id,
      taskId: run.taskId,
      runId: run.runId,
      decision: run.record.result.decision,
      summary: run.record.result.summary,
      outcome: run.record.result.state.outcome,
      loadedCheckpoint: run.record.loadedCheckpoint,
      usage: run.record.result.state.usage,
    };
  }
}
