import { z, type ZodType } from 'zod';
import type {
  ConversationRunProtocolCodecOptions,
  ConversationRunProtocolEvent,
} from './types.js';

const NonBlankStringSchema = z.string().refine((value) => Boolean(value.trim()), {
  message: 'Expected a non-empty string.',
});

export const ConversationRunReferenceSchema = z.object({
  runId: NonBlankStringSchema,
});

export const ConversationRunReplayCursorSchema = z.number().int().nonnegative().safe();

const ConversationRunProtocolEnvelopeSchema = z.object({
  runId: NonBlankStringSchema,
  sequence: z.number().int().positive().safe(),
  timestamp: z.iso.datetime(),
});

/**
 * Owns runtime validation and JSON-safe serialization for the canonical remote
 * conversation-run envelope. Hosts supply their public activity/result schemas.
 */
export class ConversationRunProtocolCodec<Activity, Result> {
  readonly eventSchema: ZodType<ConversationRunProtocolEvent<Activity, Result>>;

  constructor(options: ConversationRunProtocolCodecOptions<Activity, Result>) {
    const schema = z.discriminatedUnion('kind', [
      ConversationRunProtocolEnvelopeSchema.extend({
        kind: z.literal('activity'),
        activity: options.activity,
      }),
      ConversationRunProtocolEnvelopeSchema.extend({
        kind: z.literal('result'),
        result: options.result,
      }),
      ConversationRunProtocolEnvelopeSchema.extend({
        kind: z.literal('cancelled'),
        reason: z.string(),
      }),
      ConversationRunProtocolEnvelopeSchema.extend({
        kind: z.literal('error'),
        error: z.object({
          code: NonBlankStringSchema,
          message: z.string(),
        }),
      }),
    ]).superRefine((event, context) => {
      if (!z.json().safeParse(event).success) {
        context.addIssue({
          code: 'custom',
          message: 'Conversation run events must contain only JSON-safe values.',
        });
      }
    });

    this.eventSchema = schema as ZodType<ConversationRunProtocolEvent<Activity, Result>>;
  }

  parseEvent(input: unknown): ConversationRunProtocolEvent<Activity, Result> {
    return this.eventSchema.parse(input);
  }

  safeParseEvent(input: unknown) {
    return this.eventSchema.safeParse(input);
  }

  stringifyEvent(input: unknown): string {
    return JSON.stringify(this.parseEvent(input));
  }
}
