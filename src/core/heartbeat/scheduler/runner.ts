/**
 * Heartbeat task runner service.
 *
 * Owns the execution of one durable heartbeat task: checkpoint loading, task
 * state transitions, runner-agent invocation, checkpoint persistence, and run
 * history persistence. The scheduler decides when a task is due; this service
 * decides how that task is executed and recorded.
 */
import { DEFAULT_OPENAI_MODEL } from '@/core/config.js';
import { RuntimeCredentialService } from '@/core/runtime/credentials/index.js';
import type { AgentLoopCheckpoint, AgentLoopState } from '@/core/runtime/loop/index.js';
import { HeartbeatRunnerAgent } from '../agent/index.js';
import type { AgentHeartbeatResult, RunAgentHeartbeatOptions } from '../agent/index.js';
import { HeartbeatTaskStateProjector } from '../tasks/index.js';
import type { HeartbeatTask, HeartbeatTaskRunRecord } from '../tasks/index.js';
import type {
  HeartbeatSchedulerEvent,
  HeartbeatTaskRunner,
  HeartbeatTaskRunnerRuntimeOptions,
  RunDueHeartbeatTasksOptions,
  RunDueHeartbeatTasksResult,
} from './types.js';

const DEFAULT_FAILURE_RETRY_MS = 5 * 60_000;

export class HeartbeatTaskRunnerService {
  // Runs one already-selected task and persists the resulting task state, checkpoint, and run record.
  static async runTask(
    options: Pick<RunDueHeartbeatTasksOptions, 'store' | 'runner' | 'runtime' | 'onEvent' | 'failureRetryMs'> & {
      task: HeartbeatTask;
      runAt: Date;
    },
  ): Promise<{ record?: HeartbeatTaskRunRecord; failed: boolean }> {
    const { task, runAt } = options;
    const timestamp = runAt.toISOString();
    try {
      const checkpoint = await options.store.loadCheckpoint(task);
      const loadedCheckpoint = Boolean(checkpoint);
      const runningTask = HeartbeatTaskStateProjector.markRunning({
        task,
        now: runAt,
        loadedCheckpoint,
      });
      await options.store.saveTask(runningTask);
      options.onEvent?.(HeartbeatTaskRunnerService.startedEvent(runningTask, loadedCheckpoint, timestamp));

      const result = await HeartbeatTaskRunnerService.runAgent({
        task,
        checkpoint,
        runner: options.runner,
        runtime: options.runtime,
      });
      await options.store.saveCheckpoint(task, result.checkpoint);
      const nextTask = HeartbeatTaskStateProjector.afterResult({
        task,
        result,
        now: runAt,
        loadedCheckpoint,
      });
      await options.store.saveTask(nextTask);
      const record = { task: nextTask, result, loadedCheckpoint };
      await options.store.saveRunRecord?.(record);
      options.onEvent?.({
        type: 'heartbeat.task.finished',
        taskId: task.id,
        record,
        timestamp,
      });
      return { record, failed: false };
    } catch (error) {
      const nextTask = HeartbeatTaskStateProjector.afterFailure({
        task,
        error,
        now: runAt,
        retryMs: options.failureRetryMs ?? DEFAULT_FAILURE_RETRY_MS,
      });
      await options.store.saveTask(nextTask);
      options.onEvent?.(HeartbeatTaskRunnerService.failedEvent(nextTask, error, timestamp));
      return { failed: true };
    }
  }

  // Runs one task by id for operator-triggered paths such as web-v2 "Run now".
  static async runTaskById(options: RunDueHeartbeatTasksOptions & { taskId: string }): Promise<RunDueHeartbeatTasksResult> {
    const now = options.now?.() ?? new Date();
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
    runner?: HeartbeatTaskRunner;
    runtime?: HeartbeatTaskRunnerRuntimeOptions;
  }): Promise<AgentHeartbeatResult> {
    return args.runner ?
      await args.runner(args.task, args.checkpoint)
    : await HeartbeatRunnerAgent.run(HeartbeatTaskRunnerService.resolveRunnerAgentOptions(args));
  }

  private static resolveRunnerAgentOptions(args: {
    task: HeartbeatTask;
    checkpoint: AgentLoopState | AgentLoopCheckpoint | undefined;
    runtime?: HeartbeatTaskRunnerRuntimeOptions;
  }): RunAgentHeartbeatOptions {
    const model = args.task.runtime?.model ?? args.runtime?.model ?? process.env.OPENAI_MODEL ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_OPENAI_MODEL;
    const credentialOptions = {
      apiKey: args.runtime?.apiKey,
      apiKeyProvider: args.runtime?.apiKeyProvider,
      preferApiKey: args.runtime?.preferApiKey,
    };
    if (!RuntimeCredentialService.hasCredentialForModel(model, credentialOptions)) {
      throw new Error(RuntimeCredentialService.formatMissingCredentialMessage(model));
    }

    return {
      ...args.runtime,
      ...args.task.runtime,
      task: args.task.task,
      checkpoint: args.checkpoint,
      model,
      apiKey: RuntimeCredentialService.resolveApiKeyForModel(model, credentialOptions),
      stateDir: args.task.runtime?.stateDir ?? args.runtime?.stateDir,
      approveToolCall: HeartbeatTaskRunnerService.denyInteractiveToolCall,
      onEvent: args.runtime?.onAgentEvent,
    };
  }

  private static startedEvent(
    task: HeartbeatTask,
    loadedCheckpoint: boolean,
    timestamp: string,
  ): HeartbeatSchedulerEvent {
    return {
      type: 'heartbeat.task.started',
      taskId: task.id,
      loadedCheckpoint,
      status: task.state?.status ?? 'running',
      progress: task.state?.progress ?? '',
      timestamp,
    };
  }

  private static failedEvent(
    task: HeartbeatTask,
    error: unknown,
    timestamp: string,
  ): HeartbeatSchedulerEvent {
    return {
      type: 'heartbeat.task.failed',
      taskId: task.id,
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
