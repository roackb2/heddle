/** Provider-neutral projection from durable heartbeat records to host-facing views. */
import dayjs from 'dayjs';
import omit from 'lodash/omit.js';
import orderBy from 'lodash/orderBy.js';
import type { AgentHeartbeatResult } from '../agent/index.js';
import type {
  HeartbeatTask,
  HeartbeatTaskExecutionOutcome,
  HeartbeatTaskRunRecord,
  HeartbeatTaskRunRecordEntry,
  HeartbeatTaskState,
} from '../tasks/types.js';
import type { HeartbeatRunView, HeartbeatTaskResultView, HeartbeatTaskView } from './types.js';

export class HeartbeatTaskViewProjector {
  static projectTasks(tasks: readonly HeartbeatTask[]): HeartbeatTaskView[] {
    return orderBy(
      tasks.map((task) => HeartbeatTaskViewProjector.projectTask(task)),
      [(task) => HeartbeatTaskViewProjector.taskLastRunTime(task)],
      ['desc'],
    );
  }

  static projectTask(task: HeartbeatTask): HeartbeatTaskView {
    return {
      ...task,
      taskId: task.id,
      state: HeartbeatTaskViewProjector.projectTaskState(task.state),
    };
  }

  static projectRun(run: HeartbeatTaskRunRecordEntry): HeartbeatRunView {
    return {
      ...omit(run, ['record', 'path']),
      ...HeartbeatTaskViewProjector.projectRunRecord(run.record),
    };
  }

  static projectRunRecord(record: HeartbeatTaskRunRecord): HeartbeatRunView {
    const outcome = HeartbeatTaskViewProjector.resolveRecordOutcome(record);
    const runId = record.result?.state.runId;
    return {
      id: runId ?? outcome.executionId,
      taskId: record.task.id,
      executionId: outcome.executionId,
      runId,
      workspaceId: record.task.workspaceId,
      createdAt: outcome.finishedAt,
      task: HeartbeatTaskViewProjector.projectTask(record.task),
      result:
        record.result ? HeartbeatTaskViewProjector.projectResult(record.result)
        : HeartbeatTaskViewProjector.projectOutcome(outcome),
      loadedCheckpoint: record.loadedCheckpoint,
    };
  }

  private static projectTaskState(state: HeartbeatTaskState | undefined): HeartbeatTaskView['state'] {
    const result =
      state?.lastExecution && state.lastExecution.kind !== 'agent' ?
        HeartbeatTaskViewProjector.projectOutcome(state.lastExecution)
      : state?.result ? HeartbeatTaskViewProjector.projectResult(state.result)
      : state?.lastExecution ? HeartbeatTaskViewProjector.projectOutcome(state.lastExecution)
      : undefined;
    return {
      ...omit(state ?? {}, ['result', 'runRequest']),
      status: state?.status ?? 'idle',
      result,
      runRequest: state?.runRequest ? {
        ...state.runRequest,
        pending: state.runRequest.generation > state.runRequest.claimedGeneration,
      } : undefined,
    };
  }

  private static projectResult(result: AgentHeartbeatResult): HeartbeatTaskResultView {
    return {
      kind: 'agent',
      decision: result.decision,
      summary: result.summary,
      outcome: result.state.outcome,
      usage: result.state.usage,
    };
  }

  private static projectOutcome(outcome: HeartbeatTaskExecutionOutcome): HeartbeatTaskResultView {
    return {
      kind: outcome.kind,
      summary: outcome.summary,
      outcome: outcome.kind,
      agentRunId: outcome.kind === 'retry' || outcome.kind === 'blocked' ? outcome.agentRunId : undefined,
    };
  }

  private static resolveRecordOutcome(record: HeartbeatTaskRunRecord): HeartbeatTaskExecutionOutcome {
    if (record.outcome) {
      return record.outcome;
    }
    if (!record.result) {
      throw new Error(`Heartbeat record for task ${record.task.id} has no execution outcome.`);
    }

    return {
      kind: 'agent',
      executionId: record.result.state.runId,
      summary: record.result.summary,
      finishedAt: record.result.state.finishedAt,
    };
  }

  private static taskLastRunTime(task: HeartbeatTaskView): number {
    const runAt = task.state.runAt ? dayjs(task.state.runAt) : undefined;
    return runAt?.isValid() ? runAt.valueOf() : 0;
  }
}
