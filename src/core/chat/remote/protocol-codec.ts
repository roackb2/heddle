import type { StandardSchemaV1 } from '@standard-schema/spec';
import { z, ZodError } from 'zod';
import type {
  ConversationRunProtocolCodecOptions,
  ConversationRunProtocolEvent,
  ConversationRunProtocolEventSchema,
  ConversationRunProtocolSafeParseResult,
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

const RawConversationRunProtocolEventSchema = z.discriminatedUnion('kind', [
  ConversationRunProtocolEnvelopeSchema.extend({
    kind: z.literal('activity'),
    activity: z.unknown(),
  }),
  ConversationRunProtocolEnvelopeSchema.extend({
    kind: z.literal('result'),
    result: z.unknown(),
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
]);

export class ConversationRunProtocolValidationError extends Error {
  readonly name = 'ConversationRunProtocolValidationError';

  constructor(readonly issues: ReadonlyArray<StandardSchemaV1.Issue>) {
    super(issues.map(({ message }) => message).join('; '));
  }
}

/**
 * Owns runtime validation and JSON-safe serialization for the canonical remote
 * conversation-run envelope. Hosts supply their public activity/result schemas.
 */
export class ConversationRunProtocolCodec<Activity, Result> {
  readonly eventSchema: ConversationRunProtocolEventSchema<Activity, Result>;

  constructor(private readonly options: ConversationRunProtocolCodecOptions<Activity, Result>) {
    this.eventSchema = {
      parse: (input) => this.parseEvent(input),
      safeParse: (input) => this.safeParseEvent(input),
      '~standard': {
        version: 1,
        vendor: 'heddle',
        validate: (input) => {
          const parsed = this.safeParseEvent(input);
          return parsed.success
            ? { value: parsed.data }
            : { issues: standardIssuesFromError(parsed.error) };
        },
      },
    };
  }

  parseEvent(input: unknown): ConversationRunProtocolEvent<Activity, Result> {
    try {
      const envelope = RawConversationRunProtocolEventSchema.parse(input);
      const event = this.parseHostPayload(envelope);
      const jsonEvent = z.json().safeParse(event);
      if (!jsonEvent.success) {
        throw new ConversationRunProtocolValidationError(
          jsonEvent.error.issues.map(({ message, path }) => ({
            message: `Conversation run events must contain only JSON-safe values: ${message}`,
            path: findNonJsonValuePath(event) ?? path,
          })),
        );
      }
      return event;
    } catch (error) {
      throw normalizeProtocolError(error);
    }
  }

  safeParseEvent(input: unknown): ConversationRunProtocolSafeParseResult<Activity, Result> {
    try {
      return { success: true, data: this.parseEvent(input) };
    } catch (error) {
      return { success: false, error: normalizeProtocolError(error) };
    }
  }

  stringifyEvent(input: unknown): string {
    return JSON.stringify(this.parseEvent(input));
  }

  private parseHostPayload(
    envelope: z.infer<typeof RawConversationRunProtocolEventSchema>,
  ): ConversationRunProtocolEvent<Activity, Result> {
    if (envelope.kind === 'activity') {
      return {
        ...envelope,
        activity: parseStandardSchema(this.options.activity, envelope.activity, 'activity'),
      };
    }
    if (envelope.kind === 'result') {
      return {
        ...envelope,
        result: parseStandardSchema(this.options.result, envelope.result, 'result'),
      };
    }
    return envelope;
  }
}

function parseStandardSchema<Output>(
  schema: StandardSchemaV1<unknown, Output>,
  input: unknown,
  field: 'activity' | 'result',
): Output {
  const result = schema['~standard'].validate(input);
  if (isPromiseLike(result)) {
    throw new ConversationRunProtocolValidationError([{
      message: `Conversation run ${field} schemas must validate synchronously.`,
      path: [field],
    }]);
  }
  if (result.issues) {
    throw new ConversationRunProtocolValidationError(
      result.issues.map((issue) => ({
        ...issue,
        path: [field, ...(issue.path ?? [])],
      })),
    );
  }
  return result.value;
}

function isPromiseLike<Value>(value: unknown): value is PromiseLike<Value> {
  return typeof value === 'object'
    && value !== null
    && 'then' in value
    && typeof value.then === 'function';
}

function findNonJsonValuePath(
  value: unknown,
  path: PropertyKey[] = [],
): PropertyKey[] | undefined {
  if (z.json().safeParse(value).success) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value.reduce<PropertyKey[] | undefined>(
      (found, item, index) => found ?? findNonJsonValuePath(item, [...path, index]),
      undefined,
    ) ?? path;
  }
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).reduce<PropertyKey[] | undefined>(
      (found, [key, item]) => found ?? findNonJsonValuePath(item, [...path, key]),
      undefined,
    ) ?? path;
  }
  return path;
}

function standardIssuesFromError(error: unknown): ReadonlyArray<StandardSchemaV1.Issue> {
  if (error instanceof ConversationRunProtocolValidationError) {
    return error.issues;
  }
  if (error instanceof ZodError) {
    return error.issues.map(({ message, path }) => ({ message, path }));
  }
  return [{ message: error instanceof Error ? error.message : String(error) }];
}

function normalizeProtocolError(error: unknown): ConversationRunProtocolValidationError {
  return error instanceof ConversationRunProtocolValidationError
    ? error
    : new ConversationRunProtocolValidationError(standardIssuesFromError(error));
}
