/**
 * Heartbeat task runner service.
 *
 * Owns the execution of one durable heartbeat task: checkpoint loading, task
 * state transitions, runner-agent invocation, checkpoint persistence, and run
 * history persistence. The scheduler decides when a task is due; this service
 * decides how that task is executed and recorded.
 */
import { randomUUID } from 'node:crypto';
import dayjs from 'dayjs';
import { ToolApprovalPolicies } from '@/core/approvals/index.js';
import { DEFAULT_OPENAI_MODEL } from '@/core/config.js';
import type { AgentLoopCheckpoint, AgentLoopState } from '@/core/runtime/loop/index.js';
import { HeartbeatRunnerAgent } from '../agent/index.js';
import type { AgentHeartbeatResult, RunAgentHeartbeatOptions } from '../agent/index.js';
import { HeartbeatTaskStateProjector } from '../tasks/index.js';
import type { HeartbeatTask, HeartbeatTaskExecution, HeartbeatTaskRunRecord } from '../tasks/index.js';
import type {
  HeartbeatSchedulerEvent,
  HeartbeatTaskRunner,
  HeartbeatTaskRunnerAgentOptions,
  HeartbeatTaskRunnerRuntimeOptions,
  RunDueHeartbeatTasksOptions,
  RunDueHeartbeatTasksResult,
} from './types.js';

const DEFAULT_FAILURE_RETRY_MS = 5 * 60_000;

export class HeartbeatTaskRunnerService {
  // Runs one already-selected task and persists the resulting task state, checkpoint, and run record.
  static async runTask(
    options: Pick<RunDueHeartbeatTasksOptions, 'store' | 'runner' | 'runtime' | 'onEvent' | 'failureRetryMs' | 'executionOwnerId'> & {
      task: HeartbeatTask;
      runAt: Date;
    },
  ): Promise<{ record?: HeartbeatTaskRunRecord; failed: boolean }> {
    const { task, runAt } = options;
    const timestamp = dayjs(runAt).toISOString();
    const checkpoint = await options.store.loadCheckpoint(task);
    const loadedCheckpoint = Boolean(checkpoint);
    const execution: HeartbeatTaskExecution = {
      executionId: randomUUID(),
      ownerId: options.executionOwnerId ?? `heartbeat-worker:${randomUUID()}`,
      claimedAt: timestamp,
    };
    const claim = await options.store.claimTaskExecution({
      taskId: task.id,
      execution,
      loadedCheckpoint,
      claimedAt: runAt,
    });
    if (claim.status !== 'claimed') {
      return { failed: false };
    }

    const runningTask = claim.task;
    options.onEvent?.(HeartbeatTaskRunnerService.startedEvent(runningTask, execution, loadedCheckpoint, timestamp));

    try {
      const result = await HeartbeatTaskRunnerService.runAgent({
        task: runningTask,
        checkpoint,
        runAt,
        runner: options.runner,
        runtime: options.runtime,
        onEvent: options.onEvent,
      });
      const nextTask = HeartbeatTaskStateProjector.afterResult({
        task: runningTask,
        result,
        now: runAt,
        loadedCheckpoint,
      });
      const completion = await options.store.completeTaskExecution({
        execution,
        task: nextTask,
        checkpoint: result.checkpoint,
        result,
        loadedCheckpoint,
      });
      if (completion.status === 'claim-lost' || !completion.record) {
        return { failed: false };
      }

      const record = completion.record;
      options.onEvent?.({
        type: 'heartbeat.task.finished',
        taskId: task.id,
        executionId: execution.executionId,
        record,
        timestamp,
      });
      return { record, failed: false };
    } catch (error) {
      const nextTask = HeartbeatTaskStateProjector.afterFailure({
        task: runningTask,
        error,
        now: runAt,
        retryMs: options.failureRetryMs ?? DEFAULT_FAILURE_RETRY_MS,
      });
      const failure = await options.store.failTaskExecution({ execution, task: nextTask });
      if (failure.status === 'claim-lost') {
        return { failed: false };
      }

      options.onEvent?.(HeartbeatTaskRunnerService.failedEvent(nextTask, execution, error, timestamp));
      return { failed: true };
    }
  }

  // Runs one task by id for operator-triggered paths such as web-v2 "Run now".
  static async runTaskById(options: RunDueHeartbeatTasksOptions & { taskId: string }): Promise<RunDueHeartbeatTasksResult> {
    const now = options.now?.() ?? dayjs().toDate();
    const tasks = await options.store.listTasks();
    const task = tasks.find((candidate) => candidate.id === options.taskId);
    if (!task) {
      throw new Error(`Heartbeat task not found: ${options.taskId}`);
    }
    if (!task.enabled) {
      throw new Error(`Heartbeat task ${options.taskId} is disabled. Enable it before running.`);
    }

    const result = await HeartbeatTaskRunnerService.runTask({ ...options, task, runAt: now });
    return {
      checked: 1,
      ran: result.record ? 1 : 0,
      failed: result.failed ? 1 : 0,
      records: result.record ? [result.record] : [],
    };
  }

  private static async runAgent(args: {
    task: HeartbeatTask;
    checkpoint: AgentLoopState | AgentLoopCheckpoint | undefined;
    runAt: Date;
    runner?: HeartbeatTaskRunner;
    runtime?: HeartbeatTaskRunnerRuntimeOptions;
    onEvent?: (event: HeartbeatSchedulerEvent) => void;
  }): Promise<AgentHeartbeatResult> {
    const runAgent = async (options?: HeartbeatTaskRunnerAgentOptions) => await HeartbeatRunnerAgent.run(
      HeartbeatTaskRunnerService.resolveRunnerAgentOptions({ ...args, options }),
    );

    return args.runner
      ? await args.runner(args.task, args.checkpoint, { runAgent })
      : await runAgent();
  }

  private static resolveRunnerAgentOptions(args: {
    task: HeartbeatTask;
    checkpoint: AgentLoopState | AgentLoopCheckpoint | undefined;
    runAt: Date;
    runtime?: HeartbeatTaskRunnerRuntimeOptions;
    onEvent?: (event: HeartbeatSchedulerEvent) => void;
    options?: HeartbeatTaskRunnerAgentOptions;
  }): RunAgentHeartbeatOptions {
    const model = args.options?.model ?? args.task.runtime?.model ?? args.runtime?.model ?? process.env.OPENAI_MODEL ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_OPENAI_MODEL;

    return {
      ...args.runtime,
      ...args.task.runtime,
      ...args.options,
      task: args.options?.task ?? args.task.task,
      checkpoint: args.checkpoint,
      runContext: {
        currentDateTime: dayjs(args.runAt).toISOString(),
        intervalMs: args.task.schedule.intervalMs,
        continuationMode: args.task.continuationMode ?? 'operator',
        nextRunAt: args.task.schedule.nextRunAt,
        previousRunAt: args.task.state?.runAt,
        previousRunId: args.task.state?.runId,
      },
      model,
      workspaceRoot: args.runtime?.workspaceRoot ?? args.task.runtime?.workspaceRoot,
      stateDir: args.runtime?.stateDir ?? args.task.runtime?.stateDir,
      memoryDir: args.runtime?.memoryDir ?? args.task.runtime?.memoryDir,
      approvalPolicies: [
        ToolApprovalPolicies.unattendedLocalAutomation(),
        ...(args.runtime?.approvalPolicies ?? []),
      ],
      approveToolCall: HeartbeatTaskRunnerService.denyInteractiveToolCall,
      onEvent: (event) => {
        args.runtime?.onAgentEvent?.(event);
        args.onEvent?.({
          type: 'heartbeat.task.agent_event',
          taskId: args.task.id,
          event,
          timestamp: 'timestamp' in event && typeof event.timestamp === 'string' ? event.timestamp : dayjs().toISOString(),
        });
      },
    };
  }

  private static startedEvent(
    task: HeartbeatTask,
    execution: HeartbeatTaskExecution,
    loadedCheckpoint: boolean,
    timestamp: string,
  ): HeartbeatSchedulerEvent {
    return {
      type: 'heartbeat.task.started',
      taskId: task.id,
      executionId: execution.executionId,
      ownerId: execution.ownerId,
      loadedCheckpoint,
      status: task.state?.status ?? 'running',
      progress: task.state?.progress ?? '',
      timestamp,
    };
  }

  private static failedEvent(
    task: HeartbeatTask,
    execution: HeartbeatTaskExecution,
    error: unknown,
    timestamp: string,
  ): HeartbeatSchedulerEvent {
    return {
      type: 'heartbeat.task.failed',
      taskId: task.id,
      executionId: execution.executionId,
      error: error instanceof Error ? error.message : String(error),
      status: task.state?.status ?? 'failed',
      progress: task.state?.progress ?? '',
      nextRunAt: task.schedule.nextRunAt,
      timestamp,
    };
  }

  private static async denyInteractiveToolCall(
    call: Parameters<NonNullable<RunAgentHeartbeatOptions['approveToolCall']>>[0],
  ): ReturnType<NonNullable<RunAgentHeartbeatOptions['approveToolCall']>> {
    return {
      approved: false,
      reason: `Heartbeat task cannot request live approval for ${call.tool}.`,
    };
  }
}
