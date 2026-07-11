import { describe, expect, it } from 'vitest';
import {
  ConversationRunConsumerService,
  ConversationRunSequenceGapError,
  ConversationRunTerminalViolationError,
  type ConversationRunConsumerEvent,
  type ConversationRunReference,
} from '@/core/chat/remote/index.js';

type TestRunReference = ConversationRunReference & {
  workspaceId: string;
  sessionId: string;
};

describe('ConversationRunConsumerService', () => {
  it('advances cursors, suppresses duplicates, and preserves host reference fields', () => {
    const service = createConsumer();
    service.select(run('run-1'));

    expect(service.accept(event('activity', 1))).toEqual({ accepted: true, terminal: false });
    expect(service.accept(event('activity', 1))).toEqual({ accepted: false, terminal: false });
    expect(service.nextRetry()).toEqual({
      attempt: 1,
      delayMs: 500,
      input: {
        workspaceId: 'workspace-1',
        sessionId: 'session-1',
        runId: 'run-1',
        afterSequence: 1,
      },
    });
  });

  it('ignores events from another run without changing the selected cursor', () => {
    const service = createConsumer();
    service.select(run('run-1'));

    expect(service.accept(event('activity', 1, 'run-2'))).toEqual({ accepted: false, terminal: false });
    expect(service.subscriptionInput()?.afterSequence).toBe(0);
  });

  it('restores a selected run from a validated nonzero cursor', () => {
    const service = createConsumer();
    service.select(run('run-1'), { afterSequence: 4 });

    expect(service.subscriptionInput()).toMatchObject({
      runId: 'run-1',
      afterSequence: 4,
    });
    expect(service.accept(event('activity', 4))).toEqual({ accepted: false, terminal: false });
    expect(service.accept(event('activity', 5))).toEqual({ accepted: true, terminal: false });
  });

  it('preserves monotonic progress when the selected run is selected again', () => {
    const service = createConsumer();
    service.select(run('run-1'), { afterSequence: 2 });
    service.accept(event('activity', 3));

    expect(service.select(run('run-1'), { afterSequence: 0 })).toBe(false);
    expect(service.subscriptionInput()?.afterSequence).toBe(3);
  });

  it('rejects sequence gaps instead of silently losing activity', () => {
    const service = createConsumer();
    service.select(run('run-1'));

    expect(() => service.accept(event('activity', 2))).toThrow(ConversationRunSequenceGapError);
    expect(() => service.accept(event('activity', 2))).toThrow('expected 1, received 2');
  });

  it('stops after one terminal and rejects later non-duplicate events', () => {
    const service = createConsumer();
    service.select(run('run-1'));

    expect(service.accept(event('result', 1))).toEqual({ accepted: true, terminal: true });
    expect(service.accept(event('result', 1))).toEqual({ accepted: false, terminal: true });
    expect(service.nextRetry()).toBeUndefined();
    expect(() => service.accept(event('error', 2))).toThrow(ConversationRunTerminalViolationError);
  });

  it('resets retry attempts after progress and caps exponential delay', () => {
    const service = new ConversationRunConsumerService<TestRunReference>({
      retry: { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 150 },
    });
    service.select(run('run-1'));

    expect(service.nextRetry()?.delayMs).toBe(100);
    expect(service.nextRetry()?.delayMs).toBe(150);
    expect(service.accept(event('activity', 1))).toEqual({ accepted: true, terminal: false });
    expect(service.nextRetry()).toMatchObject({ attempt: 1, delayMs: 100 });
    expect(service.nextRetry()).toMatchObject({ attempt: 2, delayMs: 150 });
    expect(service.nextRetry()).toMatchObject({ attempt: 3, delayMs: 150 });
    expect(service.nextRetry()).toBeUndefined();
  });

  it('resets cleanly for a new run and rejects invalid inputs', () => {
    const service = createConsumer();
    service.select(run('run-1'));
    service.accept(event('cancelled', 1));

    expect(service.select(run('run-2'))).toBe(true);
    expect(service.subscriptionInput()).toMatchObject({ runId: 'run-2', afterSequence: 0 });
    expect(() => service.select(run('  '))).toThrow('non-empty runId');
    expect(() => service.select(run('run-3'), { afterSequence: -1 })).toThrow(
      'replay cursor must be a non-negative safe integer',
    );
    expect(() => service.select(run('run-3'), { afterSequence: 1.5 })).toThrow(
      'replay cursor must be a non-negative safe integer',
    );
    expect(() => service.accept(event('activity', 0, 'run-2'))).toThrow('positive safe integer');
  });

  it('validates retry configuration once at construction', () => {
    expect(() => new ConversationRunConsumerService({
      retry: { maxAttempts: -1 },
    })).toThrow('non-negative safe integer');
    expect(() => new ConversationRunConsumerService({
      retry: { baseDelayMs: 500, maxDelayMs: 100 },
    })).toThrow('cannot be less than its base delay');
  });
});

function createConsumer(): ConversationRunConsumerService<TestRunReference> {
  return new ConversationRunConsumerService<TestRunReference>();
}

function run(runId: string): TestRunReference {
  return {
    workspaceId: 'workspace-1',
    sessionId: 'session-1',
    runId,
  };
}

function event(
  kind: ConversationRunConsumerEvent['kind'],
  sequence: number,
  runId = 'run-1',
): ConversationRunConsumerEvent {
  return { kind, runId, sequence };
}
