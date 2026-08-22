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
