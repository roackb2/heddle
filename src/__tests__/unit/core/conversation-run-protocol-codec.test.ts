import { describe, expect, it } from 'vitest';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { z } from 'zod';
import {
  ConversationRunProtocolCodec,
  ConversationRunProtocolValidationError,
} from '@/core/chat/remote/index.js';

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

  it('accepts validator-agnostic Standard Schema payloads and retains transforms', () => {
    const codec = new ConversationRunProtocolCodec({
      activity: PublicActivitySchema,
      result: trimmedSummarySchema,
    });

    expect(codec.parseEvent(envelope({
      kind: 'result',
      result: { summary: '  Finished  ' },
    }))).toMatchObject({
      kind: 'result',
      result: { summary: 'Finished' },
    });
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
    expect(codec.eventSchema.parse(input)).toEqual(input);
  });

  it('exposes a Standard Schema validator for the complete event', () => {
    const codec = createCodec();
    const input = envelope({
      kind: 'result',
      result: { outcome: 'done', summary: 'Finished' },
    });
    const validation = codec.eventSchema['~standard'].validate(input);

    expect(validation).not.toBeInstanceOf(Promise);
    expect(validation).toEqual({ value: input });
  });

  it('rejects asynchronous host validators with a clear synchronous-boundary error', () => {
    const codec = new ConversationRunProtocolCodec({
      activity: asyncActivitySchema,
      result: PublicResultSchema,
    });

    expect(() => codec.parseEvent(envelope({
      kind: 'activity',
      activity: { type: 'assistant.stream' },
    }))).toThrow(ConversationRunProtocolValidationError);
    expect(() => codec.parseEvent(envelope({
      kind: 'activity',
      activity: { type: 'assistant.stream' },
    }))).toThrow('must validate synchronously');
  });
});

const trimmedSummarySchema: StandardSchemaV1<unknown, { summary: string }> = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate(value) {
      const summary = typeof value === 'object'
        && value !== null
        && 'summary' in value
        && typeof value.summary === 'string'
        ? value.summary.trim()
        : undefined;
      return summary
        ? { value: { summary } }
        : { issues: [{ message: 'Expected a non-empty summary.', path: ['summary'] }] };
    },
  },
};

const asyncActivitySchema: StandardSchemaV1<unknown, { type: string }> = {
  '~standard': {
    version: 1,
    vendor: 'test-async',
    async validate(value) {
      return { value: value as { type: string } };
    },
  },
};

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
