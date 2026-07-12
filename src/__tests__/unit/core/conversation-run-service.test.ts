import { describe, expect, it, vi } from 'vitest';
import {
  ConversationRunCancelledError,
  ConversationRunConflictError,
  ConversationRunNotFoundError,
  ConversationRunReplayUnavailableError,
  ConversationRunService,
} from '@/core/chat/runs/index.js';
import type { ConversationEngine, ConversationTurnResultSummary } from '@/core/chat/engine/index.js';
import { ChatSessionRecords } from '@/core/chat/engine/sessions/records/index.js';
import { HeddleEventType } from '@/core/event-types.js';
import type { ConversationActivity } from '@/core/live/index.js';

describe('ConversationRunService', () => {
  it('streams ordered activities and retains the settled result for reconnect', async () => {
    const service = createRunService();
    const hostActivity = vi.fn();
    const activities = [assistantActivity(1, 'Drafting'), assistantActivity(2, 'Done')];
    const result = turnResult();
    const engine = engineThatRuns(async (input) => {
      activities.forEach((activity) => input.host?.events?.onActivity?.(activity));
      return result;
    });
    const run = service.startTurn({
      address: { scopeId: 'tenant-1', sessionId: 'session-1' },
      engine,
      turn: {
        sessionId: 'session-1',
        prompt: 'Revise the document',
        host: { events: { onActivity: hostActivity } },
      },
    });

    const items = await collect(run.events());

    expect(items.map((item) => item.kind)).toEqual(['activity', 'activity', 'result']);
    expect(items.map((item) => item.sequence)).toEqual([1, 2, 3]);
    expect(hostActivity).toHaveBeenCalledTimes(2);
    await expect(run.result).resolves.toBe(result);

    const replay = await collect(service.subscribe({
      address: { scopeId: 'tenant-1', sessionId: 'session-1' },
      runId: run.runId,
      afterSequence: 1,
    }));
    expect(replay.map((item) => item.sequence)).toEqual([2, 3]);
  });

  it('cancels the engine turn and publishes a truthful terminal item', async () => {
    const service = createRunService();
    const engine = engineThatRuns(async (input) => await new Promise<never>((_resolve, reject) => {
      input.abortSignal?.addEventListener('abort', () => reject(new Error('turn aborted')), { once: true });
    }));
    const run = service.startTurn({
      address: { scopeId: 'tenant-1', sessionId: 'session-cancel' },
      engine,
      turn: { sessionId: 'session-cancel', prompt: 'Keep working' },
    });
    const itemsPromise = collect(run.events());

    await Promise.resolve();
    expect(run.cancel()).toBe(true);

    await expect(run.result).rejects.toThrow('turn aborted');
    const items = await itemsPromise;
    expect(items).toEqual([
      expect.objectContaining({ kind: 'cancelled', reason: 'Cancelled by user' }),
    ]);
    expect(service.isRunning({ scopeId: 'tenant-1', sessionId: 'session-cancel' })).toBe(false);
  });

  it('lets cancellation win when an executor ignores abort and resolves late', async () => {
    const service = createRunService();
    let finish: ((result: ConversationTurnResultSummary) => void) | undefined;
    const run = service.startTurn({
      address: { scopeId: 'tenant-1', sessionId: 'session-late-cancel' },
      engine: engineThatRuns(async () => await new Promise<ConversationTurnResultSummary>((resolve) => {
        finish = resolve;
      })),
      turn: { sessionId: 'session-late-cancel', prompt: 'Ignore cancellation' },
    });
    const items = collect(run.events());

    await Promise.resolve();
    expect(run.cancel()).toBe(true);
    finish?.(turnResult());

    await expect(run.result).rejects.toBeInstanceOf(ConversationRunCancelledError);
    await expect(items).resolves.toEqual([
      expect.objectContaining({ kind: 'cancelled', reason: 'Cancelled by user' }),
    ]);
  });

  it('awaits host result projection before publishing the canonical terminal', async () => {
    const service = createRunService();
    const releaseProjection = deferred<void>();
    const run = service.startTurn({
      address: { scopeId: 'tenant-1', sessionId: 'session-projected' },
      engine: engineThatRuns(async () => turnResult()),
      turn: { sessionId: 'session-projected', prompt: 'Project this result' },
      projectResult: async (result) => {
        await releaseProjection.promise;
        return { outcome: result.outcome, summary: result.summary };
      },
    });
    const resultState = vi.fn();
    void run.result.then(() => resultState('settled'));

    await Promise.resolve();
    await Promise.resolve();
    expect(resultState).not.toHaveBeenCalled();
    releaseProjection.resolve();

    await expect(run.result).resolves.toEqual({ outcome: 'done', summary: 'Updated' });
    await expect(collect(run.events())).resolves.toEqual([
      expect.objectContaining({
        kind: 'result',
        result: { outcome: 'done', summary: 'Updated' },
      }),
    ]);
  });

  it('settles as failed when host result projection fails', async () => {
    const service = createRunService();
    const run = service.startTurn({
      address: { scopeId: 'tenant-1', sessionId: 'session-projection-failed' },
      engine: engineThatRuns(async () => turnResult()),
      turn: { sessionId: 'session-projection-failed', prompt: 'Fail projection' },
      projectResult: () => {
        throw new Error('Could not persist public result');
      },
    });

    await expect(run.result).rejects.toThrow('Could not persist public result');
    await expect(collect(run.events())).resolves.toEqual([
      expect.objectContaining({
        kind: 'error',
        error: { code: 'run_failed', message: 'Could not persist public result' },
      }),
    ]);
  });

  it('projects internal failures into a host-owned public terminal error', async () => {
    const service = createRunService();
    const run = service.startTurn({
      address: { scopeId: 'tenant-1', sessionId: 'session-public-error' },
      engine: engineThatRuns(async () => {
        throw new Error('provider credential leaked into an internal failure');
      }),
      turn: { sessionId: 'session-public-error', prompt: 'Fail safely' },
      projectError: () => ({
        code: 'agent_unavailable',
        message: 'The agent could not complete this request.',
      }),
    });

    await expect(run.result).rejects.toThrow('provider credential leaked');
    await expect(collect(run.events())).resolves.toEqual([
      expect.objectContaining({
        kind: 'error',
        error: {
          code: 'agent_unavailable',
          message: 'The agent could not complete this request.',
        },
      }),
    ]);
  });

  it('uses a safe terminal fallback when host error projection fails', async () => {
    const service = createRunService();
    const run = service.startTurn({
      address: { scopeId: 'tenant-1', sessionId: 'session-error-projector-failed' },
      engine: engineThatRuns(async () => {
        throw new Error('internal failure');
      }),
      turn: { sessionId: 'session-error-projector-failed', prompt: 'Fail safely' },
      projectError: () => {
        throw new Error('projector failed');
      },
    });

    await expect(run.result).rejects.toThrow('internal failure');
    await expect(collect(run.events())).resolves.toEqual([
      expect.objectContaining({
        kind: 'error',
        error: {
          code: 'run_failed',
          message: 'The conversation run failed.',
        },
      }),
    ]);
  });

  it('exposes the active run identity and refuses to cancel a different run id', async () => {
    const service = createRunService();
    let finish: (() => void) | undefined;
    let accepted: { runId: string; acceptedAt: string } | undefined;
    const result = service.startAndWait({
      address: { scopeId: 'tenant-1', sessionId: 'session-active' },
      onAccepted: (run) => {
        accepted = run;
      },
      execute: async () => await new Promise<void>((resolve) => {
        finish = resolve;
      }),
    });

    expect(service.getActiveRun({ scopeId: 'tenant-1', sessionId: 'session-active' })).toEqual({
      scopeId: 'tenant-1',
      sessionId: 'session-active',
      accepted: true,
      runId: accepted?.runId,
      acceptedAt: accepted?.acceptedAt,
    });
    expect(service.cancelRun({ scopeId: 'tenant-1', sessionId: 'session-active' }, 'another-run')).toBe(false);
    expect(service.isRunning({ scopeId: 'tenant-1', sessionId: 'session-active' })).toBe(true);

    await Promise.resolve();
    finish?.();
    await result;

    expect(service.getActiveRun({ scopeId: 'tenant-1', sessionId: 'session-active' })).toBeUndefined();
  });

  it('returns retained handles with host-owned addresses for authorization', async () => {
    const service = createRunService();
    const run = service.startTurn({
      address: { scopeId: 'tenant-1', sessionId: 'session-retained' },
      engine: engineThatRuns(async () => turnResult()),
      turn: { sessionId: 'session-retained', prompt: 'Retain this run' },
    });
    await run.result;

    const retained = service.getRetainedRun<ConversationTurnResultSummary>(run.runId);

    expect(retained).toMatchObject({
      scopeId: 'tenant-1',
      sessionId: 'session-retained',
      runId: run.runId,
      accepted: true,
    });
    await expect(retained?.result).resolves.toMatchObject({ outcome: 'done', summary: 'Updated' });
    expect(retained?.cancel()).toBe(false);
    expect(service.getRetainedRun('unknown-run')).toBeUndefined();
  });

  it('throws typed conflicts and avoids delimiter collisions in default addresses', async () => {
    let runIndex = 0;
    const service = new ConversationRunService({
      replay: { retentionMs: 60_000 },
      createRunId: () => `run-${runIndex += 1}`,
    });
    const first = service.startTurn({
      address: { scopeId: 'tenant:a', sessionId: 'session' },
      engine: engineThatWaitsForAbort(),
      turn: { sessionId: 'session', prompt: 'First' },
    });
    const distinct = service.startTurn({
      address: { scopeId: 'tenant', sessionId: 'a:session' },
      engine: engineThatWaitsForAbort(),
      turn: { sessionId: 'a:session', prompt: 'Distinct' },
    });

    expect(() => service.startTurn({
      address: { scopeId: 'tenant:a', sessionId: 'session' },
      engine: engineThatRuns(async () => turnResult()),
      turn: { sessionId: 'session', prompt: 'Conflict' },
    })).toThrow(ConversationRunConflictError);
    expect(first.runId).not.toBe(distinct.runId);
    first.cancel();
    distinct.cancel();
    await Promise.allSettled([first.result, distinct.result]);
  });

  it('prevents a stale run identity from resolving a newer pending approval', async () => {
    const service = createRunService();
    const address = { scopeId: 'tenant-1', sessionId: 'session-approval' };
    let finish: (() => void) | undefined;
    const approvalResolution = vi.fn();
    const run = service.startTurn({
      address,
      engine: engineThatRuns(async () => await new Promise<ConversationTurnResultSummary>((resolve) => {
        finish = () => resolve(turnResult());
      })),
      turn: { sessionId: address.sessionId, prompt: 'Wait for approval' },
    });
    service.storePendingApproval(address, {
      approval: {
        tool: 'run_shell_mutate',
        callId: 'call-1',
        input: { command: 'yarn test' },
        requestedAt: '2026-07-11T00:00:00.000Z',
        summary: 'Run tests',
      },
      resolve: approvalResolution,
    });
    const decision = { type: 'approve' as const, reason: 'Approved' };

    expect(service.resolvePendingApproval(address, decision, 'stale-run')).toBe(false);
    expect(approvalResolution).not.toHaveBeenCalled();
    expect(run.resolveApproval(decision)).toBe(true);
    expect(approvalResolution).toHaveBeenCalledWith(decision);

    await Promise.resolve();
    finish?.();
    await run.result;
  });

  it('rejects reconnect cursors older than the bounded replay window', async () => {
    const service = new ConversationRunService({
      replay: { maxEventsPerRun: 2, retentionMs: 60_000 },
      createRunId: () => 'run-bounded',
    });
    const engine = engineThatRuns(async (input) => {
      input.host?.events?.onActivity?.(assistantActivity(1, 'One'));
      input.host?.events?.onActivity?.(assistantActivity(2, 'Two'));
      input.host?.events?.onActivity?.(assistantActivity(3, 'Three'));
      return turnResult();
    });
    const run = service.startTurn({
      address: { scopeId: 'tenant-1', sessionId: 'session-bounded' },
      engine,
      turn: { sessionId: 'session-bounded', prompt: 'Count' },
    });
    await run.result;

    expect(() => service.subscribe({
      address: { scopeId: 'tenant-1', sessionId: 'session-bounded' },
      runId: run.runId,
      afterSequence: 0,
    })).toThrow(ConversationRunReplayUnavailableError);

    const retained = await collect(service.subscribe({
      address: { scopeId: 'tenant-1', sessionId: 'session-bounded' },
      runId: run.runId,
      afterSequence: 2,
    }));
    expect(retained.map((item) => [item.sequence, item.kind])).toEqual([
      [3, 'activity'],
      [4, 'result'],
    ]);
  });

  it('throws a typed not-found error for unknown subscriptions', () => {
    const service = createRunService();

    expect(() => service.subscribe({
      address: { scopeId: 'tenant-1', sessionId: 'session-unknown' },
      runId: 'unknown-run',
    })).toThrow(ConversationRunNotFoundError);
  });
});

function createRunService(): ConversationRunService {
  return new ConversationRunService({
    replay: { retentionMs: 60_000 },
    createRunId: () => 'run-1',
  });
}

function engineThatRuns(
  submit: ConversationEngine['turns']['submit'],
): ConversationEngine {
  return {
    turns: {
      submit,
      continue: async (input) => await submit({ ...input, prompt: input.prompt ?? '' }),
      clearLease: () => undefined,
    },
  } as unknown as ConversationEngine;
}

function engineThatWaitsForAbort(): ConversationEngine {
  return engineThatRuns(async (input) => await new Promise<never>((_resolve, reject) => {
    input.abortSignal?.throwIfAborted();
    input.abortSignal?.addEventListener('abort', () => reject(new Error('turn aborted')), { once: true });
  }));
}

function assistantActivity(step: number, text: string): ConversationActivity {
  return {
    source: 'agent-loop',
    type: HeddleEventType.assistantStream,
    runId: 'agent-run-1',
    step,
    text,
    done: false,
    timestamp: `2026-07-11T00:00:0${step}.000Z`,
  };
}

function turnResult(): ConversationTurnResultSummary {
  return {
    outcome: 'done',
    summary: 'Updated',
    session: ChatSessionRecords.create({
      id: 'session-1',
      name: 'Session 1',
      model: 'gpt-5.4',
    }),
    artifacts: [],
    toolResults: [],
  };
}

async function collect<Result>(items: AsyncIterable<Result>): Promise<Result[]> {
  const collected: Result[] = [];
  for await (const item of items) {
    collected.push(item);
  }
  return collected;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
