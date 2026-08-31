/**
 * Heartbeat task runner service.
 *
 * Owns one durable execution from claim through final claim-fenced persistence.
 * Custom handlers may discover domain work, but credentials, agent defaults,
 * cancellation, checkpoints, run records, and framework events stay here.
 */
import { randomUUID } from 'node:crypto';
import dayjs from 'dayjs';
import { ToolApprovalPolicies } from '@/core/approvals/index.js';
import { DEFAULT_OPENAI_MODEL } from '@/core/config.js';
import type { AgentLoopCheckpoint } from '@/core/runtime/loop/index.js';
import { HeartbeatRunnerAgent } from '../agent/index.js';
import type { AgentHeartbeatResult, RunAgentHeartbeatOptions } from '../agent/index.js';
import { AgentHeartbeatResultSchema } from '../tasks/schemas.js';
import type {
  HeartbeatTask,
  HeartbeatTaskAgentRunRecord,
  HeartbeatTaskClaimResult,
  HeartbeatTaskClaimMode,
  HeartbeatTaskExecution,
  HeartbeatTaskNonAgentRunRecord,
  HeartbeatTaskRunRecord,
} from '../tasks/index.js';
import type {
  HeartbeatAgentExecutionTransport,
  HeartbeatExecutionContext,
  HeartbeatHandlerOutcome,
  HeartbeatSchedulerEvent,
  HeartbeatTaskHandler,
  HeartbeatTaskRunner,
  HeartbeatTaskRunnerAgentOptions,
  HeartbeatTaskRunnerRuntimeOptions,
  HeartbeatTaskExecutionResult,
  RunDueHeartbeatTasksOptions,
  RunDueHeartbeatTasksResult,
} from './types.js';
import {
  DEFAULT_HEARTBEAT_HANDLER_RETRY_MS,
  MAX_HEARTBEAT_HANDLER_OUTCOME_SUMMARY_LENGTH,
  MAX_HEARTBEAT_HANDLER_RETRY_MS,
} from './types.js';
import { HeartbeatTaskCancellationPolicy } from './cancellation-policy.js';

const DEFAULT_FAILURE_RETRY_MS = 5 * 60_000;
const CANCELLATION_SUMMARY = 'Heartbeat execution cancelled by its scheduler host.';
type ResolvedHeartbeatRunnerAgentOptions = Omit<
  RunAgentHeartbeatOptions,
  'checkpoint'
> & {
  checkpoint?: AgentLoopCheckpoint;
};

export class HeartbeatTaskRunnerService {
  // Runs one already-selected task and persists its final claim-fenced outcome.
  static async runTask(
    options: Pick<RunDueHeartbeatTasksOptions,
      | 'store'
      | 'handler'
      | 'runner'
      | 'runtime'
      | 'agentExecutionTransport'
      | 'now'
      | 'onEvent'
      | 'failureRetryMs'
      | 'executionOwnerId'
      | 'signal'
    > & {
      task: HeartbeatTask;
      runAt: Date;
      /** `due` requires the durable store to re-check eligibility while claiming. */
      claimMode?: HeartbeatTaskClaimMode;
      /** Exact interrupted execution consumed only by `claimMode: 'recovery'`. */
      recoveryOfExecutionId?: string;
    },
  ): Promise<HeartbeatTaskExecutionResult> {
    HeartbeatTaskRunnerService.assertHandlerConfiguration(options);
    if (options.signal?.aborted) {
      return HeartbeatTaskRunnerService.cancelledResult(options.task.id);
    }

    const { task, runAt } = options;
    const startedAt = dayjs(runAt).toISOString();
    const checkpoint = await options.store.loadCheckpoint(task);
    if (options.signal?.aborted) {
      return HeartbeatTaskRunnerService.cancelledResult(task.id);
    }

    const loadedCheckpoint = Boolean(checkpoint);
    const proposedExecution: HeartbeatTaskExecution = {
      executionId: randomUUID(),
      ownerId: options.executionOwnerId ?? `heartbeat-worker:${randomUUID()}`,
      claimedAt: startedAt,
    };
    const claim = await options.store.claimTaskExecution({
      taskId: task.id,
      execution: proposedExecution,
      loadedCheckpoint,
      claimedAt: runAt,
      claimMode: options.claimMode,
      recoveryOfExecutionId: options.recoveryOfExecutionId,
    });
    if (claim.status !== 'claimed') {
      return HeartbeatTaskRunnerService.claimResult(task.id, claim);
    }

    const runningTask = claim.task;
    const execution = runningTask.state?.execution ?? proposedExecution;
    const scopeController = new AbortController();
    const executionSignal = HeartbeatTaskRunnerService.composeExecutionSignal(options.signal, scopeController.signal);
    if (execution.runRequestGeneration !== undefined) {
      options.onEvent?.({
        type: 'heartbeat.task.run_request_claimed',
        taskId: task.id,
        executionId: execution.executionId,
        generation: execution.runRequestGeneration,
        timestamp: startedAt,
      });
    }
    options.onEvent?.(HeartbeatTaskRunnerService.startedEvent(runningTask, execution, loadedCheckpoint, startedAt));

    try {
      const result = await HeartbeatTaskRunnerService.invokeHandler({
        task: runningTask,
        checkpoint,
        execution,
        runAt,
        signal: executionSignal,
        scopeController,
        handler: options.handler,
        runner: options.runner,
        runtime: options.runtime,
        agentExecutionTransport: options.agentExecutionTransport,
        onEvent: options.onEvent,
      });
      if (options.signal?.aborted) {
        return await HeartbeatTaskRunnerService.persistCancellation({
          ...options,
          task: runningTask,
          execution,
        });
      }

      const settledAt = options.now?.() ?? dayjs().toDate();
      if (HeartbeatTaskRunnerService.isSkippedOutcome(result)) {
        const completion = await options.store.recordTaskExecutionOutcome({
          execution,
          taskId: task.id,
          kind: 'skipped',
          summary: result.summary,
          finishedAt: settledAt,
          signal: options.signal,
        });
        if (completion.status === 'cancelled') {
          return await HeartbeatTaskRunnerService.persistCancellation({
            ...options,
            task: runningTask,
            execution,
          });
        }
        if (completion.status !== 'saved' || !HeartbeatTaskRunnerService.isNonAgentRecord(completion.record, 'skipped')) {
          if (completion.status === 'claim-lost') {
            return HeartbeatTaskRunnerService.claimLostResult(task.id, execution.executionId);
          }
          throw new Error(`Heartbeat store saved an invalid skipped record for task ${task.id}.`);
        }

        options.onEvent?.({
          type: 'heartbeat.task.skipped',
          taskId: task.id,
          executionId: execution.executionId,
          record: completion.record,
          timestamp: completion.record.outcome.finishedAt,
        });
        return HeartbeatTaskRunnerService.settledResult(task.id, execution.executionId, completion.record);
      }

      if (HeartbeatTaskRunnerService.isExplicitHandlerOutcome(result)) {
        const completion = await options.store.recordTaskExecutionOutcome({
          execution,
          taskId: task.id,
          kind: result.kind,
          summary: result.summary,
          agentRunId: result.agentRunId,
          retryMs: result.kind === 'retry' ? result.delayMs : undefined,
          finishedAt: settledAt,
          signal: options.signal,
        });
        if (completion.status === 'cancelled') {
          return await HeartbeatTaskRunnerService.persistCancellation({
            ...options,
            task: runningTask,
            execution,
          });
        }
        if (completion.status === 'claim-lost') {
          return HeartbeatTaskRunnerService.claimLostResult(task.id, execution.executionId);
        }

        if (result.kind === 'retry') {
          if (!HeartbeatTaskRunnerService.isNonAgentRecord(completion.record, 'retry')) {
            throw new Error(`Heartbeat store saved an invalid retry record for task ${task.id}.`);
          }
          options.onEvent?.({
            type: 'heartbeat.task.retry',
            taskId: task.id,
            executionId: execution.executionId,
            record: completion.record,
            timestamp: completion.record.outcome.finishedAt,
          });
        } else {
          if (!HeartbeatTaskRunnerService.isNonAgentRecord(completion.record, 'blocked')) {
            throw new Error(`Heartbeat store saved an invalid blocked record for task ${task.id}.`);
          }
          options.onEvent?.({
            type: 'heartbeat.task.blocked',
            taskId: task.id,
            executionId: execution.executionId,
            record: completion.record,
            timestamp: completion.record.outcome.finishedAt,
          });
        }
        return HeartbeatTaskRunnerService.settledResult(task.id, execution.executionId, completion.record);
      }

      const completion = await options.store.completeTaskExecution({
        execution,
        taskId: task.id,
        checkpoint: result.checkpoint,
        result,
        loadedCheckpoint,
        completedAt: settledAt,
        signal: options.signal,
      });
      if (completion.status === 'cancelled') {
        return await HeartbeatTaskRunnerService.persistCancellation({
          ...options,
          task: runningTask,
          execution,
        });
      }
      if (completion.status !== 'saved' || !HeartbeatTaskRunnerService.isAgentRecord(completion.record)) {
        if (completion.status === 'claim-lost') {
          return HeartbeatTaskRunnerService.claimLostResult(task.id, execution.executionId);
        }
        throw new Error(`Heartbeat store saved an invalid agent record for task ${task.id}.`);
      }

      options.onEvent?.({
        type: 'heartbeat.task.finished',
        taskId: task.id,
        executionId: execution.executionId,
        record: completion.record,
        timestamp: completion.record.outcome?.finishedAt ?? result.state.finishedAt,
      });
      return HeartbeatTaskRunnerService.settledResult(task.id, execution.executionId, completion.record);
    } catch (error) {
      if (options.signal?.aborted) {
        return await HeartbeatTaskRunnerService.persistCancellation({
          ...options,
          task: runningTask,
          execution,
        });
      }

      const settledAt = options.now?.() ?? dayjs().toDate();
      const failure = await options.store.failTaskExecution({
        execution,
        taskId: task.id,
        error,
        failedAt: settledAt,
        retryMs: options.failureRetryMs ?? DEFAULT_FAILURE_RETRY_MS,
        signal: options.signal,
      });
      if (failure.status === 'cancelled') {
        return await HeartbeatTaskRunnerService.persistCancellation({
          ...options,
          task: runningTask,
          execution,
        });
      }
      if (failure.status === 'claim-lost') {
        return HeartbeatTaskRunnerService.claimLostResult(task.id, execution.executionId);
      }

      options.onEvent?.(HeartbeatTaskRunnerService.failedEvent(failure.task, execution, error, dayjs(settledAt).toISOString()));
      return {
        status: 'failed',
        taskId: task.id,
        executionId: execution.executionId,
        error: HeartbeatTaskRunnerService.errorMessage(error),
        task: failure.task,
        failed: true,
      };
    } finally {
      scopeController.abort();
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

  private static async invokeHandler(args: {
    task: HeartbeatTask;
    checkpoint: AgentLoopCheckpoint | undefined;
    execution: HeartbeatTaskExecution;
    runAt: Date;
    signal: AbortSignal;
    scopeController: AbortController;
    handler?: HeartbeatTaskHandler;
    runner?: HeartbeatTaskRunner;
    runtime?: HeartbeatTaskRunnerRuntimeOptions;
    agentExecutionTransport?: HeartbeatAgentExecutionTransport;
    onEvent?: (event: HeartbeatSchedulerEvent) => void;
  }): Promise<AgentHeartbeatResult | HeartbeatHandlerOutcome> {
    let active = true;
    let agentInvocation: Promise<AgentHeartbeatResult> | undefined;
    let agentResult: AgentHeartbeatResult | undefined;
    let skipSelected = false;
    let explicitOutcome: HeartbeatHandlerOutcome | undefined;

    const context: HeartbeatExecutionContext = Object.freeze({
      task: structuredClone(args.task),
      checkpoint: args.checkpoint ? structuredClone(args.checkpoint) : undefined,
      executionId: args.execution.executionId,
      runAt: new Date(args.runAt),
      signal: args.signal,
      runAgent: async (options?: HeartbeatTaskRunnerAgentOptions) => {
        HeartbeatTaskRunnerService.assertContextActive(active, args.execution.executionId);
        if (skipSelected || explicitOutcome) {
          throw new Error('Cannot run an agent after selecting a heartbeat execution outcome.');
        }
        if (agentInvocation) {
          throw new Error('Heartbeat execution context runAgent() may be called only once.');
        }

        const runnerOptions = HeartbeatTaskRunnerService.resolveRunnerAgentOptions({
          ...args,
          options,
        });
        agentInvocation = args.agentExecutionTransport
          ? HeartbeatTaskRunnerService.executeThroughTransport({
            ...args,
            runnerOptions,
            transport: args.agentExecutionTransport,
          })
          : HeartbeatRunnerAgent.run(runnerOptions);
        agentResult = await agentInvocation;
        return agentResult;
      },
      skip: (input: { summary: string }) => {
        HeartbeatTaskRunnerService.assertContextActive(active, args.execution.executionId);
        if (agentInvocation) {
          throw new Error('Cannot skip a heartbeat execution after runAgent() has started.');
        }
        if (skipSelected) {
          throw new Error('Heartbeat execution context skip() may be called only once.');
        }

        const summary = input.summary.trim();
        if (!summary) {
          throw new Error('A skipped heartbeat execution requires a non-empty summary.');
        }
        skipSelected = true;
        return Object.freeze({ kind: 'skipped' as const, summary });
      },
      retry: (input: { summary: string; delayMs?: number }) => {
        HeartbeatTaskRunnerService.assertContextActive(active, args.execution.executionId);
        const result = HeartbeatTaskRunnerService.requireCompletedAgentResult(agentResult);
        if (skipSelected || explicitOutcome) {
          throw new Error('Heartbeat execution context may select only one outcome.');
        }

        const outcome = Object.freeze({
          kind: 'retry' as const,
          summary: HeartbeatTaskRunnerService.normalizeHandlerOutcomeSummary(input.summary),
          delayMs: HeartbeatTaskRunnerService.normalizeHandlerRetryDelay(input.delayMs),
          agentRunId: result.state.runId,
        });
        explicitOutcome = outcome;
        return outcome;
      },
      block: (input: { summary: string }) => {
        HeartbeatTaskRunnerService.assertContextActive(active, args.execution.executionId);
        const result = HeartbeatTaskRunnerService.requireCompletedAgentResult(agentResult);
        if (skipSelected || explicitOutcome) {
          throw new Error('Heartbeat execution context may select only one outcome.');
        }

        const outcome = Object.freeze({
          kind: 'blocked' as const,
          summary: HeartbeatTaskRunnerService.normalizeHandlerOutcomeSummary(input.summary),
          agentRunId: result.state.runId,
        });
        explicitOutcome = outcome;
        return outcome;
      },
    });

    const legacyRunner = args.runner;
    const handler: HeartbeatTaskHandler = args.handler ?? (
      legacyRunner ?
        async (handlerContext: HeartbeatExecutionContext) => await legacyRunner(
          handlerContext.task,
          handlerContext.checkpoint,
          handlerContext,
        )
      : async (handlerContext: HeartbeatExecutionContext) => await handlerContext.runAgent()
    );

    try {
      const result = await handler(context);
      if (HeartbeatTaskRunnerService.isSkippedOutcome(result)) {
        if (!skipSelected || agentInvocation) {
          throw new Error('Custom heartbeat handlers must return the outcome created by context.skip().');
        }
        return result;
      }
      if (HeartbeatTaskRunnerService.isExplicitHandlerOutcome(result)) {
        if (!agentInvocation || !agentResult || result !== explicitOutcome) {
          throw new Error('Custom heartbeat handlers must return the retry or blocked outcome created by their execution context after runAgent() settles.');
        }
        return result;
      }
      if (explicitOutcome) {
        throw new Error('Custom heartbeat handlers must return the retry or blocked outcome created by their execution context after selecting it.');
      }
      if (!HeartbeatTaskRunnerService.isAgentResult(result)) {
        throw new Error('Custom heartbeat handler returned an unsupported execution outcome.');
      }
      if (args.handler && (!agentInvocation || result !== agentResult)) {
        throw new Error('Custom heartbeat handlers must return the AgentHeartbeatResult produced by context.runAgent().');
      }
      if (agentInvocation && result !== agentResult) {
        throw new Error('Heartbeat handler returned an agent result other than the result produced by context.runAgent().');
      }
      return result;
    } catch (error) {
      if (agentInvocation && !agentResult) {
        args.scopeController.abort(error);
        await agentInvocation.catch(() => undefined);
      }
      throw error;
    } finally {
      active = false;
    }
  }

  private static resolveRunnerAgentOptions(args: {
    task: HeartbeatTask;
    checkpoint: AgentLoopCheckpoint | undefined;
    execution: HeartbeatTaskExecution;
    runAt: Date;
    signal: AbortSignal;
    runtime?: HeartbeatTaskRunnerRuntimeOptions;
    onEvent?: (event: HeartbeatSchedulerEvent) => void;
    options?: HeartbeatTaskRunnerAgentOptions;
  }): ResolvedHeartbeatRunnerAgentOptions {
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
        ...(args.options?.approvalPolicies ?? []),
      ],
      approveToolCall: HeartbeatTaskRunnerService.denyInteractiveToolCall,
      abortSignal: args.signal,
      onEvent: (event) => {
        args.options?.onEvent?.(event);
        args.runtime?.onAgentEvent?.(event);
        args.onEvent?.({
          type: 'heartbeat.task.agent_event',
          taskId: args.task.id,
          executionId: args.execution.executionId,
          event,
          timestamp: 'timestamp' in event && typeof event.timestamp === 'string' ? event.timestamp : dayjs().toISOString(),
        });
      },
    };
  }

  private static async executeThroughTransport(args: {
    task: HeartbeatTask;
    execution: HeartbeatTaskExecution;
    signal: AbortSignal;
    runnerOptions: ResolvedHeartbeatRunnerAgentOptions;
    transport: HeartbeatAgentExecutionTransport;
    onEvent?: (event: HeartbeatSchedulerEvent) => void;
  }): Promise<AgentHeartbeatResult> {
    const runContext = args.runnerOptions.runContext;
    if (!runContext) {
      throw new Error('Remote heartbeat execution requires a run context.');
    }
    const result = await args.transport.execute({
      request: {
        taskId: args.task.id,
        executionId: args.execution.executionId,
        task: args.runnerOptions.task,
        ...(args.runnerOptions.checkpoint
          ? { checkpoint: structuredClone(args.runnerOptions.checkpoint) }
          : {}),
        runContext: structuredClone(runContext),
        ...(args.runnerOptions.model ? { model: args.runnerOptions.model } : {}),
        ...(args.runnerOptions.reasoningEffort
          ? { reasoningEffort: args.runnerOptions.reasoningEffort }
          : {}),
        ...(args.runnerOptions.maxSteps !== undefined
          ? { maxSteps: args.runnerOptions.maxSteps }
          : {}),
        ...(args.runnerOptions.searchIgnoreDirs
          ? { searchIgnoreDirs: [...args.runnerOptions.searchIgnoreDirs] }
          : {}),
        ...(args.runnerOptions.systemContext
          ? { systemContext: args.runnerOptions.systemContext }
          : {}),
      },
      signal: args.signal,
      publishActivity: (activity) => args.onEvent?.({
        type: 'heartbeat.task.agent_activity',
        taskId: args.task.id,
        executionId: args.execution.executionId,
        activity,
        timestamp: dayjs().toISOString(),
      }),
    });
    const parsed = AgentHeartbeatResultSchema.safeParse(result);
    if (!parsed.success) {
      throw new Error('Heartbeat agent execution transport returned an invalid result.');
    }
    return parsed.data as AgentHeartbeatResult;
  }

  private static async persistCancellation(args: Pick<RunDueHeartbeatTasksOptions, 'store' | 'now' | 'onEvent' | 'signal'> & {
    task: HeartbeatTask;
    execution: HeartbeatTaskExecution;
  }): Promise<HeartbeatTaskExecutionResult> {
    const settledAt = args.now?.() ?? dayjs().toDate();
    const reason = HeartbeatTaskCancellationPolicy.readSignalReason(args.signal);
    const completion = await args.store.recordTaskExecutionOutcome({
      execution: args.execution,
      taskId: args.task.id,
      kind: 'cancelled',
      summary: reason ? `${CANCELLATION_SUMMARY} Reason: ${reason}` : CANCELLATION_SUMMARY,
      reason,
      finishedAt: settledAt,
    });
    if (completion.status === 'claim-lost') {
      return HeartbeatTaskRunnerService.claimLostResult(args.task.id, args.execution.executionId);
    }
    if (completion.status === 'cancelled') {
      return HeartbeatTaskRunnerService.cancelledResult(args.task.id, args.execution.executionId);
    }
    if (!HeartbeatTaskRunnerService.isNonAgentRecord(completion.record, 'cancelled')) {
      throw new Error(`Heartbeat store saved an invalid cancelled record for task ${args.task.id}.`);
    }

    args.onEvent?.({
      type: 'heartbeat.task.cancelled',
      taskId: args.task.id,
      executionId: args.execution.executionId,
      reason,
      record: completion.record,
      timestamp: completion.record.outcome.finishedAt,
    });
    return HeartbeatTaskRunnerService.cancelledResult(
      args.task.id,
      args.execution.executionId,
      completion.record,
    );
  }

  private static claimResult(
    taskId: string,
    claim: Exclude<HeartbeatTaskClaimResult, { status: 'claimed' }>,
  ): HeartbeatTaskExecutionResult {
    if (claim.status === 'not-due') {
      return {
        status: 'not-due',
        taskId,
        nextRunAt: claim.task.schedule.nextRunAt,
        failed: false,
      };
    }
    if (claim.status === 'admission-closed') {
      return {
        status: 'admission-closed',
        taskId,
        target: claim.target,
        failed: false,
      };
    }
    return { status: claim.status, taskId, failed: false };
  }

  private static settledResult(
    taskId: string,
    executionId: string,
    record: HeartbeatTaskRunRecord,
  ): HeartbeatTaskExecutionResult {
    if (HeartbeatTaskRunnerService.isNonAgentRecord(record, 'retry')) {
      return { status: 'retry', taskId, executionId, record, failed: false };
    }
    return { status: 'settled', taskId, executionId, record, failed: false };
  }

  private static claimLostResult(taskId: string, executionId: string): HeartbeatTaskExecutionResult {
    return { status: 'claim-lost', taskId, executionId, failed: false };
  }

  private static cancelledResult(
    taskId: string,
    executionId?: string,
    record?: HeartbeatTaskRunRecord,
  ): HeartbeatTaskExecutionResult {
    return { status: 'cancelled', taskId, executionId, record, failed: false };
  }

  private static errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private static composeExecutionSignal(cancellationSignal: AbortSignal | undefined, scopeSignal: AbortSignal): AbortSignal {
    return cancellationSignal ? AbortSignal.any([cancellationSignal, scopeSignal]) : scopeSignal;
  }

  static assertHandlerConfiguration(options: Pick<RunDueHeartbeatTasksOptions, 'handler' | 'runner'>): void {
    if (options.handler && options.runner) {
      throw new Error('Configure either heartbeat handler or deprecated runner, not both.');
    }
  }

  private static assertContextActive(active: boolean, executionId: string): void {
    if (!active) {
      throw new Error(`Heartbeat execution context ${executionId} is no longer active.`);
    }
  }

  private static isSkippedOutcome(value: unknown): value is HeartbeatHandlerOutcome {
    return Boolean(value && typeof value === 'object' && 'kind' in value && value.kind === 'skipped');
  }

  private static isExplicitHandlerOutcome(value: unknown): value is Extract<HeartbeatHandlerOutcome, { kind: 'retry' | 'blocked' }> {
    return Boolean(value && typeof value === 'object' && 'kind' in value && (value.kind === 'retry' || value.kind === 'blocked'));
  }

  private static isAgentResult(value: unknown): value is AgentHeartbeatResult {
    return Boolean(
      value
      && typeof value === 'object'
      && 'decision' in value
      && 'summary' in value
      && 'state' in value
      && 'checkpoint' in value,
    );
  }

  private static isAgentRecord(record: HeartbeatTaskRunRecord | undefined): record is HeartbeatTaskAgentRunRecord {
    return Boolean(record?.result);
  }

  private static isNonAgentRecord<K extends 'skipped' | 'cancelled' | 'retry' | 'blocked'>(
    record: HeartbeatTaskRunRecord | undefined,
    kind: K,
  ): record is HeartbeatTaskNonAgentRunRecord & { outcome: { kind: K } } {
    return Boolean(record && !record.result && record.outcome?.kind === kind);
  }

  private static requireCompletedAgentResult(result: AgentHeartbeatResult | undefined): AgentHeartbeatResult {
    if (!result) {
      throw new Error('Heartbeat execution context retry() and block() require context.runAgent() to settle first.');
    }
    return result;
  }

  private static normalizeHandlerOutcomeSummary(summary: string): string {
    const normalized = summary.trim();
    if (!normalized) {
      throw new Error('A heartbeat retry or blocked outcome requires a non-empty, non-secret summary.');
    }
    if (normalized.length > MAX_HEARTBEAT_HANDLER_OUTCOME_SUMMARY_LENGTH) {
      throw new Error(`Heartbeat retry and blocked summaries must be at most ${MAX_HEARTBEAT_HANDLER_OUTCOME_SUMMARY_LENGTH} characters.`);
    }
    return normalized;
  }

  private static normalizeHandlerRetryDelay(delayMs: number | undefined): number {
    const resolvedDelayMs = delayMs ?? DEFAULT_HEARTBEAT_HANDLER_RETRY_MS;
    if (!Number.isSafeInteger(resolvedDelayMs) || resolvedDelayMs < 1 || resolvedDelayMs > MAX_HEARTBEAT_HANDLER_RETRY_MS) {
      throw new Error(`Heartbeat retry delay must be a positive integer no greater than ${MAX_HEARTBEAT_HANDLER_RETRY_MS} milliseconds.`);
    }
    return resolvedDelayMs;
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
