import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ConversationRunProtocolCodec } from '@/core/chat/remote/index.js';

const PublicActivitySchema = z.object({
  type: z.string().min(1),
}).passthrough();
const PublicResultSchema = z.object({
  outcome: z.string().min(1),
  summary: z.string(),
});

describe('ConversationRunProtocolCodec', () => {
  it('validates every canonical event kind', () => {
    const codec = createCodec();

    expect(codec.parseEvent(envelope({
      kind: 'activity',
      activity: { type: 'assistant.stream', text: 'Working' },
    }))).toMatchObject({ kind: 'activity', activity: { text: 'Working' } });
    expect(codec.parseEvent(envelope({
      kind: 'result',
      result: { outcome: 'done', summary: 'Finished' },
    }))).toMatchObject({ kind: 'result', result: { outcome: 'done' } });
    expect(codec.parseEvent(envelope({
      kind: 'cancelled',
      reason: 'Cancelled by user',
    }))).toMatchObject({ kind: 'cancelled' });
    expect(codec.parseEvent(envelope({
      kind: 'error',
      error: { code: 'run_failed', message: 'Failed' },
    }))).toMatchObject({ kind: 'error' });
  });

  it('applies the host result schema before data crosses the boundary', () => {
    const event = createCodec().parseEvent(envelope({
      kind: 'result',
      result: {
        outcome: 'done',
        summary: 'Public summary',
        internalSession: { secret: true },
      },
    }));

    expect(event).toEqual(envelope({
      kind: 'result',
      result: { outcome: 'done', summary: 'Public summary' },
    }));
  });

  it('rejects malformed envelopes and host payloads', () => {
    const codec = createCodec();

    expect(() => codec.parseEvent({
      ...envelope({ kind: 'cancelled', reason: 'Cancelled' }),
      sequence: 0,
    })).toThrow();
    expect(() => codec.parseEvent({
      ...envelope({ kind: 'cancelled', reason: 'Cancelled' }),
      timestamp: 'not-a-date',
    })).toThrow();
    expect(() => codec.parseEvent(envelope({
      kind: 'result',
      result: { outcome: 'done' },
    }))).toThrow();
  });

  it('rejects non-JSON-safe values after host schema parsing', () => {
    const codec = createCodec();

    expect(() => codec.parseEvent(envelope({
      kind: 'activity',
      activity: { type: 'tool.calling', unsafe: 1n },
    }))).toThrow('JSON-safe');
    expect(() => codec.parseEvent(envelope({
      kind: 'activity',
      activity: { type: 'tool.calling', unsafe: undefined },
    }))).toThrow('JSON-safe');
  });

  it('round-trips validated events through JSON serialization', () => {
    const codec = createCodec();
    const input = envelope({
      kind: 'result',
      result: { outcome: 'done', summary: 'Finished' },
    });

    expect(codec.parseEvent(JSON.parse(codec.stringifyEvent(input)))).toEqual(input);
    expect(codec.safeParseEvent(input).success).toBe(true);
  });
});

function createCodec() {
  return new ConversationRunProtocolCodec({
    activity: PublicActivitySchema,
    result: PublicResultSchema,
  });
}

function envelope(payload: Record<string, unknown>) {
  return {
    runId: 'run-1',
    sequence: 1,
    timestamp: '2026-07-11T00:00:00.000Z',
    ...payload,
  };
}
