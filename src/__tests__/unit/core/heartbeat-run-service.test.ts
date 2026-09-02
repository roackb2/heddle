import { describe, expect, it, vi } from 'vitest';
import { HeartbeatRunService } from '@/core/heartbeat/runs/index.js';
import type {
  AgentHeartbeatEvent,
  AgentHeartbeatResult,
  RunAgentHeartbeatOptions,
} from '@/core/heartbeat/agent/index.js';

describe('HeartbeatRunService', () => {
  it('publishes ordered activity followed by one result terminal', async () => {
    const activity = heartbeatActivity();
    const heartbeatResult = result();
    const runner = vi.fn(async (options: RunAgentHeartbeatOptions) => {
      options.onEvent?.(activity);
      return heartbeatResult;
    });
    const timestamps = ['2026-08-18T12:00:01.000Z', '2026-08-18T12:00:02.000Z'];
    const service = new HeartbeatRunService({
      createRunId: () => 'heartbeat-run-1',
      now: () => timestamps.shift() ?? '2026-08-18T12:00:03.000Z',
      runner,
    });

    const run = service.start({ task: 'Review the workspace.' });

    await expect(run.result).resolves.toBe(heartbeatResult);
    await expect(collect(run.events())).resolves.toEqual([
      {
        kind: 'activity',
        activity,
        runId: 'heartbeat-run-1',
        sequence: 1,
        timestamp: '2026-08-18T12:00:01.000Z',
      },
      {
        kind: 'result',
        result: heartbeatResult,
        runId: 'heartbeat-run-1',
        sequence: 2,
        timestamp: '2026-08-18T12:00:02.000Z',
      },
    ]);
    expect(run.cancel()).toBe(false);
  });

  it('projects stream payloads onto a JSON-compatible boundary', async () => {
    const activity = {
      ...heartbeatActivity(),
      optionalDetail: undefined,
    } as AgentHeartbeatEvent;
    const heartbeatResult = result();
    heartbeatResult.state.usage = undefined;
    const runner = vi.fn(async (options: RunAgentHeartbeatOptions) => {
      options.onEvent?.(activity);
      return heartbeatResult;
    });
    const service = new HeartbeatRunService({
      createRunId: () => 'heartbeat-run-json',
      now: () => '2026-08-18T12:00:00.000Z',
      runner,
    });

    const run = service.start({ task: 'Review the workspace.' });
    await run.result;
    const events = await collect(run.events());

    expect(events).toEqual(JSON.parse(JSON.stringify(events)));
    expect(events[0]).not.toHaveProperty('activity.optionalDetail');
    expect(events[1]).not.toHaveProperty('result.state.usage');
  });

  it('awaits host result projection before resolving or publishing the result terminal', async () => {
    const heartbeatResult = result();
    const projectionStarted = deferred<void>();
    const releaseProjection = deferred<void>();
    const runner = vi.fn(async () => heartbeatResult);
    const service = new HeartbeatRunService({
      createRunId: () => 'heartbeat-run-projected',
      now: () => '2026-08-18T12:00:30.000Z',
      runner,
    });
    const run = service.start({
      task: 'Review the workspace.',
      projectResult: async (value, context) => {
        expect(context.runId).toBe('heartbeat-run-projected');
        expect(context.signal.aborted).toBe(false);
        projectionStarted.resolve();
        await releaseProjection.promise;
        return { decision: value.decision, summary: value.summary };
      },
    });
    const iterator = run.events()[Symbol.asyncIterator]();
    const terminal = iterator.next();
    const resultSettled = vi.fn();
    const terminalSettled = vi.fn();
    void run.result.then(resultSettled);
    void terminal.then(terminalSettled);

    await projectionStarted.promise;
    await Promise.resolve();
    expect(resultSettled).not.toHaveBeenCalled();
    expect(terminalSettled).not.toHaveBeenCalled();
    expect(runner.mock.calls[0]?.[0]).not.toHaveProperty('projectResult');

    releaseProjection.resolve();

    const projected = {
      decision: heartbeatResult.decision,
      summary: heartbeatResult.summary,
    };
    await expect(run.result).resolves.toEqual(projected);
    await expect(terminal).resolves.toEqual({
      done: false,
      value: {
        kind: 'result',
        result: projected,
        runId: 'heartbeat-run-projected',
        sequence: 1,
        timestamp: '2026-08-18T12:00:30.000Z',
      },
    });
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
  });

  it('publishes only the safe error terminal when host result projection fails', async () => {
    const runner = vi.fn(async () => result());
    const service = new HeartbeatRunService({
      createRunId: () => 'heartbeat-run-projection-failed',
      now: () => '2026-08-18T12:00:45.000Z',
      runner,
    });
    const run = service.start({
      task: 'Review the workspace.',
      projectResult: () => {
        throw new Error('durable checkpoint commit failed');
      },
    });

    await expect(run.result).rejects.toThrow('durable checkpoint commit failed');
    await expect(collect(run.events())).resolves.toEqual([
      {
        kind: 'error',
        error: {
          code: 'heartbeat_run_failed',
          message: 'The heartbeat run could not complete.',
        },
        runId: 'heartbeat-run-projection-failed',
        sequence: 1,
        timestamp: '2026-08-18T12:00:45.000Z',
      },
    ]);
  });

  it.each(['handle', 'external'] as const)(
    'lets %s cancellation win while host result projection is pending',
    async (cancellationSource) => {
      const projectionStarted = deferred<void>();
      const releaseProjection = deferred<void>();
      const externalController = new AbortController();
      let projectionSignal: AbortSignal | undefined;
      const runner = vi.fn(async () => result());
      const service = new HeartbeatRunService({
        createRunId: () => `heartbeat-run-${cancellationSource}-projection-cancelled`,
        now: () => '2026-08-18T12:00:50.000Z',
        runner,
      });
      const run = service.start({
        task: 'Review the workspace.',
        abortSignal: externalController.signal,
        projectResult: async (value, context) => {
          projectionSignal = context.signal;
          projectionStarted.resolve();
          await releaseProjection.promise;
          return value;
        },
      });

      await projectionStarted.promise;
      if (cancellationSource === 'handle') {
        expect(run.cancel()).toBe(true);
        releaseProjection.resolve();
      } else {
        externalController.abort(new Error('External heartbeat cancellation.'));
        releaseProjection.reject(new Error('Late projection failure must not win.'));
      }
      expect(projectionSignal?.aborted).toBe(true);

      await expect(run.result).rejects.toThrow(
        cancellationSource === 'handle'
          ? 'Heartbeat run was cancelled.'
          : 'External heartbeat cancellation.',
      );
      await expect(collect(run.events())).resolves.toEqual([
        {
          kind: 'cancelled',
          reason: 'Heartbeat run was cancelled.',
          runId: `heartbeat-run-${cancellationSource}-projection-cancelled`,
          sequence: 1,
          timestamp: '2026-08-18T12:00:50.000Z',
        },
      ]);
    },
  );

  it('aborts an active runner and publishes cancellation as the terminal', async () => {
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const runner = vi.fn(async (options: RunAgentHeartbeatOptions) => {
      markStarted?.();
      return await new Promise<AgentHeartbeatResult>((_resolve, reject) => {
        options.abortSignal?.addEventListener('abort', () => reject(options.abortSignal?.reason), {
          once: true,
        });
      });
    });
    const service = new HeartbeatRunService({
      createRunId: () => 'heartbeat-run-cancelled',
      now: () => '2026-08-18T12:01:00.000Z',
      runner,
    });
    const run = service.start({ task: 'Review the workspace.' });
    await started;

    expect(run.cancel()).toBe(true);
    await expect(run.result).rejects.toThrow('Heartbeat run was cancelled.');
    await expect(collect(run.events())).resolves.toEqual([
      {
        kind: 'cancelled',
        reason: 'Heartbeat run was cancelled.',
        runId: 'heartbeat-run-cancelled',
        sequence: 1,
        timestamp: '2026-08-18T12:01:00.000Z',
      },
    ]);
    expect(run.cancel()).toBe(false);
  });

  it('keeps runner failures out of the public error terminal', async () => {
    const runner = vi.fn(async () => {
      throw new Error('provider response contained sensitive diagnostics');
    });
    const service = new HeartbeatRunService({
      createRunId: () => 'heartbeat-run-failed',
      now: () => '2026-08-18T12:02:00.000Z',
      runner,
    });
    const run = service.start({ task: 'Review the workspace.' });

    await expect(run.result).rejects.toThrow('sensitive diagnostics');
    await expect(collect(run.events())).resolves.toEqual([
      {
        kind: 'error',
        error: {
          code: 'heartbeat_run_failed',
          message: 'The heartbeat run could not complete.',
        },
        runId: 'heartbeat-run-failed',
        sequence: 1,
        timestamp: '2026-08-18T12:02:00.000Z',
      },
    ]);
  });
});

function heartbeatActivity(): AgentHeartbeatEvent {
  return {
    type: 'heartbeat.decision',
    runId: 'agent-run-1',
    decision: 'complete',
    outcome: 'done',
    summary: 'Workspace reviewed.',
    timestamp: '2026-08-18T12:00:00.000Z',
  };
}

function result(): AgentHeartbeatResult {
  const state = {
    status: 'finished' as const,
    runId: 'agent-run-1',
    goal: 'Review the workspace.',
    model: 'gpt-5',
    provider: 'openai' as const,
    workspaceRoot: '/workspace',
    startedAt: '2026-08-18T11:59:00.000Z',
    finishedAt: '2026-08-18T12:00:00.000Z',
    outcome: 'done' as const,
    summary: 'Workspace reviewed.',
    transcript: [],
    trace: [],
  };

  return {
    decision: 'complete',
    summary: state.summary,
    state,
    checkpoint: {
      version: 1,
      runId: state.runId,
      createdAt: state.finishedAt,
      state,
    },
  };
}

async function collect<Event>(events: AsyncIterable<Event>): Promise<Event[]> {
  const collected: Event[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
}

function deferred<Value>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
