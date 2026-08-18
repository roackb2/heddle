import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LlmAdapterService } from '@/core/llm/index.js';
import {
  FileHeartbeatTaskService,
  DEFAULT_HEARTBEAT_HANDLER_RETRY_MS,
  HeartbeatRunnerAgent,
  HeartbeatSchedulerService,
  type AgentHeartbeatResult,
  type HeartbeatExecutionContext,
  type HeartbeatAgentExecutionTransport,
  type HeartbeatSchedulerEvent,
  type HeartbeatTask,
  type RunAgentHeartbeatOptions,
} from '../../../advanced.js';
import { AgentLoopCheckpointService } from '@/core/runtime/loop/index.js';

const NOW = new Date('2026-08-01T05:00:00.000Z');

describe('heartbeat execution context', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('persists no-work without provider calls, fabricated agent state, or checkpoint changes', async () => {
    const dir = createStateRoot('skip');
    const store = new FileHeartbeatTaskService({ dir });
    const task: HeartbeatTask = {
      ...createTask('no-work'),
      runtime: { model: 'gpt-5.4' },
    };
    const priorCheckpoint = createHeartbeatResult('pause', 'prior-run').checkpoint;
    await store.saveTask(task);
    await store.saveCheckpoint(task, priorCheckpoint);
    const runAgent = vi.spyOn(HeartbeatRunnerAgent, 'run');
    const createAdapter = vi.spyOn(LlmAdapterService, 'create');
    const events: HeartbeatSchedulerEvent[] = [];
    let retainedContext: HeartbeatExecutionContext | undefined;

    const result = await HeartbeatSchedulerService.runDueTasks({
      store,
      now: () => NOW,
      handler: async (context) => {
        retainedContext = context;
        context.task.task = 'A host-local mutation must not reach persistence.';
        expect(context.checkpoint).toMatchObject({ runId: priorCheckpoint.runId });
        return context.skip({ summary: 'No domain work is currently available.' });
      },
      onEvent: (event) => events.push(structuredClone(event)),
    });

    expect(result).toMatchObject({ checked: 1, ran: 1, failed: 0 });
    expect(runAgent).not.toHaveBeenCalled();
    expect(createAdapter).not.toHaveBeenCalled();
    await expect(store.loadCheckpoint(task)).resolves.toEqual(priorCheckpoint);
    await expect(store.requireTask(task.id)).resolves.toMatchObject({
      task: task.task,
      schedule: { nextRunAt: '2026-08-01T05:01:00.000Z' },
      state: {
        status: 'waiting',
        lastExecution: {
          kind: 'skipped',
          summary: 'No domain work is currently available.',
        },
      },
    });
    const savedTask = await store.requireTask(task.id);
    expect(savedTask.state?.runId).toBeUndefined();
    expect(savedTask.state?.result).toBeUndefined();

    const [entry] = await store.listRunRecords({ taskId: task.id });
    expect(entry).toMatchObject({
      executionId: expect.any(String),
      runId: undefined,
      record: {
        outcome: {
          kind: 'skipped',
          summary: 'No domain work is currently available.',
        },
      },
    });
    expect(entry?.record.result).toBeUndefined();
    expect(entry?.record.loadedCheckpoint).toBeUndefined();
    expect(entry?.record.task.runtime?.model).toBe('gpt-5.4');
    expect(JSON.stringify(entry?.record)).not.toMatch(/checkpoint|transcript|provider|runId/);
    expect(events.map((event) => event.type)).toEqual([
      'heartbeat.task.due',
      'heartbeat.task.started',
      'heartbeat.task.skipped',
    ]);
    expect(events[1]).toMatchObject({ executionId: entry?.executionId });
    expect(events[2]).toMatchObject({ executionId: entry?.executionId });
    expect(() => retainedContext?.skip({ summary: 'too late' })).toThrow(/no longer active/);
  });

  it('routes dynamic prompts, tools, policy, abort, and events through the standard agent builder', async () => {
    const dir = createStateRoot('dynamic');
    const store = new FileHeartbeatTaskService({ dir });
    const task = createTask('dynamic-work');
    await store.saveTask(task);
    const agentResult = createHeartbeatResult('continue', 'dynamic-run');
    let receivedOptions: RunAgentHeartbeatOptions | undefined;
    const runAgent = vi.spyOn(HeartbeatRunnerAgent, 'run').mockImplementation(async (options) => {
      receivedOptions = options;
      options.onEvent?.({
        type: 'checkpoint.saved',
        runId: agentResult.state.runId,
        checkpoint: agentResult.checkpoint,
        step: 1,
        timestamp: NOW.toISOString(),
      });
      return agentResult;
    });
    const events: HeartbeatSchedulerEvent[] = [];
    const domainTool = {
      name: 'claim_domain_work',
      description: 'Claim one domain-owned work item.',
      parameters: { type: 'object', properties: {} },
      execute: async () => ({ ok: true, output: 'claimed' }),
    };
    let executionContext: HeartbeatExecutionContext | undefined;

    const result = await HeartbeatSchedulerService.runDueTasks({
      store,
      now: () => NOW,
      runtime: {
        workspaceRoot: dir,
        stateDir: dir,
        model: 'gpt-test',
        includeDefaultTools: false,
      },
      handler: async (context) => {
        executionContext = context;
        return await context.runAgent({
          task: 'Process claimed work item domain-42.',
          systemContext: 'Only operate on domain-42.',
          tools: [domainTool],
          maxSteps: 3,
        });
      },
      onEvent: (event) => events.push(event),
    });

    expect(result).toMatchObject({ checked: 1, ran: 1, failed: 0 });
    expect(runAgent).toHaveBeenCalledOnce();
    expect(receivedOptions).toMatchObject({
      task: 'Process claimed work item domain-42.',
      systemContext: 'Only operate on domain-42.',
      tools: [domainTool],
      maxSteps: 3,
      checkpoint: undefined,
      abortSignal: executionContext?.signal,
      approvalPolicies: expect.arrayContaining([expect.any(Function)]),
    });
    expect(receivedOptions?.approveToolCall).toEqual(expect.any(Function));
    expect(events.find((event) => event.type === 'heartbeat.task.agent_event')).toMatchObject({
      executionId: executionContext?.executionId,
      event: { type: 'checkpoint.saved' },
    });
    expect(events.at(-1)).toMatchObject({
      type: 'heartbeat.task.finished',
      executionId: executionContext?.executionId,
    });
    await expect(store.loadCheckpoint(task)).resolves.toEqual(agentResult.checkpoint);
    await expect(store.listRunRecords({ taskId: task.id })).resolves.toMatchObject([{
      executionId: executionContext?.executionId,
      runId: agentResult.state.runId,
      record: {
        outcome: { kind: 'agent', executionId: executionContext?.executionId },
        result: agentResult,
      },
    }]);
  });

  it('delegates portable agent work and validates the result before durable settlement', async () => {
    const dir = createStateRoot('remote-transport');
    const store = new FileHeartbeatTaskService({ dir });
    const task: HeartbeatTask = {
      ...createTask('remote-transport'),
      runtime: {
        model: 'gpt-remote',
        maxSteps: 4,
        systemContext: 'Use the hosted workspace.',
      },
    };
    const priorCheckpoint = createHeartbeatResult('pause', 'remote-prior').checkpoint;
    const remoteResult = createHeartbeatResult('continue', 'remote-result');
    await store.saveTask(task);
    await store.saveCheckpoint(task, priorCheckpoint);
    const events: HeartbeatSchedulerEvent[] = [];
    let received: Parameters<HeartbeatAgentExecutionTransport['execute']>[0] | undefined;
    const transport: HeartbeatAgentExecutionTransport = {
      execute: async (input) => {
        received = input;
        input.publishActivity({ type: 'assistant_text_delta', text: 'Working.' });
        return structuredClone(remoteResult);
      },
    };
    const localAgent = vi.spyOn(HeartbeatRunnerAgent, 'run');

    await expect(HeartbeatSchedulerService.runDueTasks({
      store,
      now: () => NOW,
      agentExecutionTransport: transport,
      onEvent: (event) => events.push(event),
    })).resolves.toMatchObject({ checked: 1, ran: 1, failed: 0 });

    expect(localAgent).not.toHaveBeenCalled();
    expect(received?.request).toMatchObject({
      taskId: task.id,
      executionId: expect.any(String),
      task: task.task,
      checkpoint: priorCheckpoint,
      runContext: {
        currentDateTime: NOW.toISOString(),
        intervalMs: task.schedule.intervalMs,
      },
      model: 'gpt-remote',
      maxSteps: 4,
      systemContext: 'Use the hosted workspace.',
    });
    expect(received?.request).not.toHaveProperty('apiKey');
    expect(received?.request).not.toHaveProperty('tools');
    expect(received?.request).not.toHaveProperty('workspaceRoot');
    expect(events).toContainEqual(expect.objectContaining({
      type: 'heartbeat.task.agent_activity',
      taskId: task.id,
      activity: { type: 'assistant_text_delta', text: 'Working.' },
    }));
    await expect(store.loadCheckpoint(task)).resolves.toEqual(
      remoteResult.checkpoint,
    );

    const invalidDir = createStateRoot('invalid-remote-result');
    const invalidStore = new FileHeartbeatTaskService({ dir: invalidDir });
    await invalidStore.saveTask(createTask('invalid-remote-result'));
    await expect(HeartbeatSchedulerService.runDueTasks({
      store: invalidStore,
      now: () => NOW,
      agentExecutionTransport: {
        execute: async () => ({ status: 'pretend-success' }),
      },
    })).resolves.toMatchObject({ checked: 1, ran: 0, failed: 1 });
    await expect(invalidStore.loadCheckpoint(
      createTask('invalid-remote-result'),
    )).resolves.toBeUndefined();
    await expect(invalidStore.requireTask('invalid-remote-result'))
      .resolves.toMatchObject({
        state: {
          status: 'failed',
          error: 'Heartbeat agent execution transport returned an invalid result.',
        },
      });
  });

  it('cancels active work, awaits handler settlement, and persists cancellation after a late result', async () => {
    const dir = createStateRoot('cancel');
    const store = new FileHeartbeatTaskService({ stateRoot: dir });
    const task = createTask('cancel-work');
    const priorCheckpoint = createHeartbeatResult('pause', 'prior-cancel-run').checkpoint;
    await store.saveTask(task);
    await store.saveCheckpoint(task, priorCheckpoint);
    const controlledRun = deferred<AgentHeartbeatResult>();
    vi.spyOn(HeartbeatRunnerAgent, 'run').mockImplementation(async () => await controlledRun.promise);
    const contextReady = deferred<HeartbeatExecutionContext>();
    const events: HeartbeatSchedulerEvent[] = [];
    const handle = HeartbeatSchedulerService.start({
      workspaceRoot: dir,
      stateRoot: dir,
      pollIntervalMs: 60_000,
      handler: async (context) => {
        contextReady.resolve(context);
        return await context.runAgent();
      },
      onEvent: (event) => events.push(event),
    });

    const context = await contextReady.promise;
    const firstStop = handle.stop({ cancelRunning: true });
    const repeatedStop = handle.stop({ cancelRunning: true });
    expect(repeatedStop).toBe(firstStop);
    expect(context.signal.aborted).toBe(true);
    let stopped = false;
    void firstStop.then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);

    controlledRun.resolve(createHeartbeatResult('continue', 'late-run'));
    await firstStop;
    expect(stopped).toBe(true);
    await expect(handle.stop({ cancelRunning: true })).resolves.toBeUndefined();
    await expect(store.loadCheckpoint(task)).resolves.toEqual(priorCheckpoint);
    await expect(store.requireTask(task.id)).resolves.toMatchObject({
      schedule: { nextRunAt: expect.any(String) },
      state: {
        status: 'waiting',
        lastExecution: { kind: 'cancelled', executionId: context.executionId },
      },
    });
    expect((await store.requireTask(task.id)).state?.result).toBeUndefined();
    await expect(store.listRunRecords({ taskId: task.id })).resolves.toMatchObject([{
      executionId: context.executionId,
      runId: undefined,
      record: { outcome: { kind: 'cancelled' } },
    }]);
    expect((await store.listRunRecords({ taskId: task.id }))[0]?.record.result).toBeUndefined();
    expect(events.map((event) => event.type)).toEqual([
      'heartbeat.scheduler.started',
      'heartbeat.task.due',
      'heartbeat.task.started',
      'heartbeat.task.cancelled',
      'heartbeat.scheduler.stopped',
    ]);
  });

  it('stops admissions without cancelling active work when cancelRunning is omitted', async () => {
    const dir = createStateRoot('drain');
    const store = new FileHeartbeatTaskService({ stateRoot: dir });
    const task = createTask('drain-work');
    await store.saveTask(task);
    const controlledRun = deferred<AgentHeartbeatResult>();
    vi.spyOn(HeartbeatRunnerAgent, 'run').mockImplementation(async () => await controlledRun.promise);
    const contextReady = deferred<HeartbeatExecutionContext>();
    const handle = HeartbeatSchedulerService.start({
      workspaceRoot: dir,
      stateRoot: dir,
      pollIntervalMs: 60_000,
      handler: async (context) => {
        contextReady.resolve(context);
        return await context.runAgent();
      },
    });

    const context = await contextReady.promise;
    const stopping = handle.stop();
    expect(context.signal.aborted).toBe(false);
    controlledRun.resolve(createHeartbeatResult('continue', 'drained-run'));
    await stopping;

    await expect(store.listRunRecords({ taskId: task.id })).resolves.toMatchObject([{
      runId: 'drained-run',
      record: { outcome: { kind: 'agent' } },
    }]);
  });

  it('applies failure policy before and after agent start while preserving old runner compatibility', async () => {
    const beforeDir = createStateRoot('handler-failure');
    const beforeStore = new FileHeartbeatTaskService({ dir: beforeDir });
    await beforeStore.saveTask(createTask('handler-failure'));
    const before = await HeartbeatSchedulerService.runDueTasks({
      store: beforeStore,
      now: () => NOW,
      failureRetryMs: 5_000,
      handler: async () => {
        throw new Error('domain claim failed');
      },
    });
    expect(before).toMatchObject({ ran: 0, failed: 1 });
    await expect(beforeStore.requireTask('handler-failure')).resolves.toMatchObject({
      schedule: { nextRunAt: '2026-08-01T05:00:05.000Z' },
      state: { status: 'failed', error: 'domain claim failed', lastExecution: { kind: 'failed' } },
    });

    const afterDir = createStateRoot('agent-failure');
    const afterStore = new FileHeartbeatTaskService({ dir: afterDir });
    await afterStore.saveTask(createTask('agent-failure'));
    vi.spyOn(HeartbeatRunnerAgent, 'run').mockRejectedValueOnce(new Error('agent runtime failed'));
    const after = await HeartbeatSchedulerService.runDueTasks({
      store: afterStore,
      now: () => NOW,
      handler: async (context) => await context.runAgent(),
    });
    expect(after).toMatchObject({ ran: 0, failed: 1 });
    await expect(afterStore.requireTask('agent-failure')).resolves.toMatchObject({
      state: { status: 'failed', error: 'agent runtime failed', lastExecution: { kind: 'failed' } },
    });

    vi.restoreAllMocks();
    const legacyDir = createStateRoot('legacy');
    const legacyStore = new FileHeartbeatTaskService({ dir: legacyDir });
    await legacyStore.saveTask(createTask('legacy-runner'));
    const legacy = await HeartbeatSchedulerService.runDueTasks({
      store: legacyStore,
      now: () => NOW,
      runner: async (scheduledTask, checkpoint, context) => {
        expect(scheduledTask.id).toBe('legacy-runner');
        expect(checkpoint).toBeUndefined();
        expect(context.runAgent).toEqual(expect.any(Function));
        return createHeartbeatResult('continue', 'legacy-run');
      },
    });
    expect(legacy).toMatchObject({ ran: 1, failed: 0 });
  });

  it('persists explicit retry outcomes without installing rejected agent results or replacing checkpoints', async () => {
    const dir = createStateRoot('explicit-retry');
    const store = new FileHeartbeatTaskService({ dir });
    const defaultDelayTask = createTask('default-retry');
    const selectedDelayDir = createStateRoot('selected-retry');
    const selectedDelayStore = new FileHeartbeatTaskService({ dir: selectedDelayDir });
    const selectedDelayTask = createTask('selected-retry');
    const priorCheckpoint = createHeartbeatResult('pause', 'prior-retry-run').checkpoint;
    await Promise.all([
      store.saveTask(defaultDelayTask),
      store.saveCheckpoint(defaultDelayTask, priorCheckpoint),
      selectedDelayStore.saveTask(selectedDelayTask),
    ]);
    const rejectedDefaultResult = createHeartbeatResult('continue', 'rejected-default-agent-run');
    const rejectedSelectedResult = createHeartbeatResult('continue', 'rejected-selected-agent-run');
    const runAgent = vi.spyOn(HeartbeatRunnerAgent, 'run')
      .mockResolvedValueOnce(rejectedDefaultResult)
      .mockResolvedValueOnce(rejectedSelectedResult);
    const events: HeartbeatSchedulerEvent[] = [];

    const defaultDelay = await HeartbeatSchedulerService.runDueTasks({
      store,
      now: () => NOW,
      handler: async (context) => {
        await context.runAgent();
        return context.retry({ summary: '  Host settlement rejected this run.  ' });
      },
      onEvent: (event) => events.push(event),
    });
    expect(defaultDelay).toMatchObject({ checked: 1, ran: 1, failed: 0 });
    expect(runAgent).toHaveBeenCalledOnce();

    await expect(store.loadCheckpoint(defaultDelayTask)).resolves.toEqual(priorCheckpoint);
    await expect(store.requireTask(defaultDelayTask.id)).resolves.toMatchObject({
      schedule: { nextRunAt: new Date(NOW.valueOf() + DEFAULT_HEARTBEAT_HANDLER_RETRY_MS).toISOString() },
      state: {
        status: 'waiting',
        lastExecution: {
          kind: 'retry',
          summary: 'Host settlement rejected this run.',
          agentRunId: rejectedDefaultResult.state.runId,
        },
      },
    });
    const retriedTask = await store.requireTask(defaultDelayTask.id);
    expect(retriedTask.state?.result).toBeUndefined();
    expect(retriedTask.state?.runId).toBeUndefined();

    const selectedDelay = await HeartbeatSchedulerService.runDueTasks({
      store: selectedDelayStore,
      now: () => NOW,
      handler: async (context) => {
        await context.runAgent();
        return context.retry({ summary: 'Retry after the host settles.', delayMs: 1_234 });
      },
    });
    expect(selectedDelay).toMatchObject({ ran: 1, failed: 0 });
    expect(runAgent).toHaveBeenCalledTimes(2);
    await expect(selectedDelayStore.requireTask(selectedDelayTask.id)).resolves.toMatchObject({
      schedule: { nextRunAt: '2026-08-01T05:00:01.234Z' },
      state: { lastExecution: { kind: 'retry', agentRunId: rejectedSelectedResult.state.runId } },
    });

    const [retryRecord] = await store.listRunRecords({ taskId: defaultDelayTask.id });
    expect(retryRecord).toMatchObject({
      executionId: expect.any(String),
      runId: undefined,
      record: {
        outcome: {
          kind: 'retry',
          agentRunId: rejectedDefaultResult.state.runId,
          summary: 'Host settlement rejected this run.',
        },
      },
    });
    expect(retryRecord?.record.result).toBeUndefined();
    expect(FileHeartbeatTaskService.projectRunRecordView(retryRecord!.record).result).toMatchObject({
      kind: 'retry',
      agentRunId: rejectedDefaultResult.state.runId,
    });
    expect(events.filter((event) => event.type === 'heartbeat.task.retry')).toHaveLength(1);
  });

  it('blocks rejected nested agent results until an explicit resume', async () => {
    const dir = createStateRoot('explicit-block');
    const store = new FileHeartbeatTaskService({ dir });
    const task = createTask('block-me');
    const priorCheckpoint = createHeartbeatResult('pause', 'prior-block-run').checkpoint;
    const rejectedResult = createHeartbeatResult('escalate', 'rejected-block-agent-run');
    await Promise.all([
      store.saveTask(task),
      store.saveCheckpoint(task, priorCheckpoint),
    ]);
    vi.spyOn(HeartbeatRunnerAgent, 'run').mockResolvedValue(rejectedResult);
    const events: HeartbeatSchedulerEvent[] = [];

    await expect(HeartbeatSchedulerService.runDueTasks({
      store,
      now: () => NOW,
      handler: async (context) => {
        await context.runAgent();
        return context.block({ summary: '  Operator acknowledgement is required. ' });
      },
      onEvent: (event) => events.push(event),
    })).resolves.toMatchObject({ ran: 1, failed: 0 });

    await expect(store.loadCheckpoint(task)).resolves.toEqual(priorCheckpoint);
    await expect(store.requireTask(task.id)).resolves.toMatchObject({
      enabled: false,
      state: {
        status: 'blocked',
        lastExecution: {
          kind: 'blocked',
          summary: 'Operator acknowledgement is required.',
          agentRunId: rejectedResult.state.runId,
        },
      },
    });
    const blockedTask = await store.requireTask(task.id);
    expect(blockedTask.schedule.nextRunAt).toBeUndefined();
    expect(blockedTask.state?.result).toBeUndefined();
    expect(blockedTask.state?.runId).toBeUndefined();
    await expect(store.requestTaskRun(task.id)).rejects.toThrow(/blocked.*resume/i);
    await expect(store.setTaskEnabled(task.id, true)).rejects.toThrow(/blocked.*resume/i);
    await expect(store.resumeTask(task.id)).resolves.toMatchObject({
      enabled: true,
      state: { status: 'waiting' },
    });
    expect(events.map((event) => event.type)).toContain('heartbeat.task.blocked');
  });

  it('treats cancellation and claim loss as final over explicit handler outcomes', async () => {
    const cancellationDir = createStateRoot('retry-cancelled');
    const cancellationStore = new FileHeartbeatTaskService({ dir: cancellationDir });
    const cancellationTask = createTask('retry-cancelled');
    const priorCheckpoint = createHeartbeatResult('pause', 'prior-cancelled-retry-run').checkpoint;
    await Promise.all([
      cancellationStore.saveTask(cancellationTask),
      cancellationStore.saveCheckpoint(cancellationTask, priorCheckpoint),
    ]);
    const controlledRun = deferred<AgentHeartbeatResult>();
    vi.spyOn(HeartbeatRunnerAgent, 'run').mockImplementation(async () => await controlledRun.promise);
    const contextReady = deferred<HeartbeatExecutionContext>();
    const events: HeartbeatSchedulerEvent[] = [];
    const handle = HeartbeatSchedulerService.start({
      workspaceRoot: cancellationDir,
      stateRoot: cancellationDir,
      store: cancellationStore,
      pollIntervalMs: 60_000,
      handler: async (context) => {
        contextReady.resolve(context);
        await context.runAgent();
        return context.retry({ summary: 'This retry must lose to cancellation.' });
      },
      onEvent: (event) => events.push(event),
    });
    await contextReady.promise;
    const stopping = handle.stop({ cancelRunning: true });
    controlledRun.resolve(createHeartbeatResult('continue', 'cancelled-retry-agent-run'));
    await stopping;
    await expect(cancellationStore.loadCheckpoint(cancellationTask)).resolves.toEqual(priorCheckpoint);
    await expect(cancellationStore.listRunRecords({ taskId: cancellationTask.id })).resolves.toMatchObject([{
      record: { outcome: { kind: 'cancelled' } },
    }]);
    expect(events.some((event) => event.type === 'heartbeat.task.retry')).toBe(false);

    vi.restoreAllMocks();
    const claimLossDir = createStateRoot('retry-claim-loss');
    const claimLossStore = new FileHeartbeatTaskService({ dir: claimLossDir });
    const claimLossTask = createTask('retry-claim-loss');
    await claimLossStore.saveTask(claimLossTask);
    const rejectedResult = createHeartbeatResult('continue', 'claim-lost-agent-run');
    vi.spyOn(HeartbeatRunnerAgent, 'run').mockResolvedValue(rejectedResult);
    const recordOutcome = vi.spyOn(claimLossStore, 'recordTaskExecutionOutcome')
      .mockResolvedValueOnce({ status: 'claim-lost' });

    await expect(HeartbeatSchedulerService.runDueTasks({
      store: claimLossStore,
      now: () => NOW,
      handler: async (context) => {
        await context.runAgent();
        return context.retry({ summary: 'This retry lost its execution claim.' });
      },
    })).resolves.toMatchObject({ ran: 0, failed: 0, records: [] });
    expect(recordOutcome).toHaveBeenCalledOnce();
    await expect(claimLossStore.loadCheckpoint(claimLossTask)).resolves.toBeUndefined();
    await expect(claimLossStore.listRunRecords({ taskId: claimLossTask.id })).resolves.toEqual([]);
  });

  it('rejects forged, premature, oversized, and invalid-delay handler outcomes as failures', async () => {
    const cases = [
      {
        id: 'premature-retry',
        handler: async (context: HeartbeatExecutionContext) => context.retry({ summary: 'Too early.' }),
        error: /runAgent\(\).*settle first/i,
      },
      {
        id: 'forged-outcome',
        handler: async () => ({ kind: 'blocked', summary: 'Forged.', agentRunId: 'not-a-real-run' } as never),
        error: /must return the retry or blocked outcome/i,
      },
      {
        id: 'discarded-retry-outcome',
        handler: async (context: HeartbeatExecutionContext) => {
          const result = await context.runAgent();
          context.retry({ summary: 'The rejected result must not be installed.' });
          return result;
        },
        error: /must return the retry or blocked outcome.*after selecting/i,
      },
      {
        id: 'oversized-summary',
        handler: async (context: HeartbeatExecutionContext) => {
          await context.runAgent();
          return context.retry({ summary: 'x'.repeat(501) });
        },
        error: /at most 500 characters/i,
      },
      {
        id: 'invalid-delay',
        handler: async (context: HeartbeatExecutionContext) => {
          await context.runAgent();
          return context.retry({ summary: 'Invalid delay.', delayMs: 0 });
        },
        error: /positive integer/i,
      },
    ];

    for (const testCase of cases) {
      const dir = createStateRoot(testCase.id);
      const store = new FileHeartbeatTaskService({ dir });
      await store.saveTask(createTask(testCase.id));
      vi.spyOn(HeartbeatRunnerAgent, 'run').mockResolvedValue(createHeartbeatResult('continue', `${testCase.id}-agent-run`));

      await expect(HeartbeatSchedulerService.runDueTasks({
        store,
        now: () => NOW,
        handler: testCase.handler,
      })).resolves.toMatchObject({ ran: 0, failed: 1 });
      await expect(store.requireTask(testCase.id)).resolves.toMatchObject({
        state: { status: 'failed', error: expect.stringMatching(testCase.error) },
      });
      vi.restoreAllMocks();
    }
  });

  it('stops idempotently while idle', async () => {
    const dir = createStateRoot('idle');
    const handle = HeartbeatSchedulerService.start({
      workspaceRoot: dir,
      stateRoot: dir,
      pollIntervalMs: 60_000,
    });

    const first = handle.stop({ cancelRunning: true });
    expect(handle.stop()).toBe(first);
    await expect(first).resolves.toBeUndefined();
  });

  it('rejects handler and deprecated runner configuration before scheduler work starts', async () => {
    const dir = createStateRoot('invalid-handler-configuration');
    const handler = async (context: HeartbeatExecutionContext) => context.skip({ summary: 'No work.' });
    const runner = async () => createHeartbeatResult('continue', 'unused-run');

    expect(() => HeartbeatSchedulerService.start({
      workspaceRoot: dir,
      stateRoot: dir,
      handler,
      runner,
    })).toThrow(/either heartbeat handler or deprecated runner/);
    await expect(HeartbeatSchedulerService.runDueTasks({
      store: new FileHeartbeatTaskService({ dir }),
      handler,
      runner,
    })).rejects.toThrow(/either heartbeat handler or deprecated runner/);
  });
});

function createStateRoot(label: string): string {
  return mkdtempSync(join(tmpdir(), `heddle-heartbeat-context-${label}-`));
}

function createTask(id: string): HeartbeatTask {
  return {
    id,
    task: `Process ${id}.`,
    enabled: true,
    schedule: {
      intervalMs: 60_000,
      nextRunAt: '2000-01-01T00:00:00.000Z',
    },
  };
}

function createHeartbeatResult(
  decision: AgentHeartbeatResult['decision'],
  runId: string,
): AgentHeartbeatResult {
  const summary = `Heartbeat result.\n\nHEARTBEAT_DECISION: ${decision}`;
  const state = {
    status: 'finished' as const,
    runId,
    goal: 'Heartbeat runner cycle.',
    model: 'gpt-test',
    provider: 'openai' as const,
    workspaceRoot: '/tmp/project',
    startedAt: NOW.toISOString(),
    finishedAt: '2026-08-01T05:00:01.000Z',
    outcome: 'done' as const,
    summary,
    transcript: [],
    trace: [],
  };

  return {
    decision,
    summary,
    state,
    checkpoint: AgentLoopCheckpointService.createCheckpoint(state, {
      createdAt: state.finishedAt,
    }),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
