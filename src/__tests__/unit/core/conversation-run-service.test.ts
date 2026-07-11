import { describe, expect, it, vi } from 'vitest';
import { ConversationRunService } from '@/core/chat/runs/index.js';
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
    })).toThrow('replay cursor 0 is older than retained sequence 3');

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
