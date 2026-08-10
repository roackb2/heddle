import { once } from 'node:events';
import type { ServerResponse } from 'node:http';
import { z } from 'zod';
import {
  EXECUTION_CONTRACT_VERSION,
  ExecutionHostStreamEventSchema,
  OpaqueIdSchema,
  RuntimePublicResultSchema,
} from '../contracts/index.js';
import type { LocalExecutionHostTerminal } from './types.js';

const ErrorCodeSchema = z.string().min(1).max(128).regex(/^[a-z0-9_]+$/);
const TerminalSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('result'),
    result: RuntimePublicResultSchema,
  }).strict(),
  z.object({
    kind: z.literal('cancelled'),
    reason: z.string().min(1).max(1_600),
  }).strict(),
  z.object({
    kind: z.literal('error'),
    error: z.object({
      code: ErrorCodeSchema,
      message: z.string().min(1).max(1_600),
    }).strict(),
  }).strict(),
  z.object({ kind: z.literal('interrupted') }).strict(),
]);

type EventBody =
  | { kind: 'accepted' }
  | { kind: 'activity'; activity: unknown }
  | Exclude<LocalExecutionHostTerminal, { kind: 'interrupted' }>;

export class LocalExecutionHostEventStream {
  readonly #response: ServerResponse;
  readonly #signal: AbortSignal;
  readonly #invocationId: string;
  readonly #runId: string;
  readonly #now: () => Date;
  #sequence = 0;

  private constructor(input: {
    response: ServerResponse;
    signal: AbortSignal;
    invocationId: string;
    runId: string;
    now: () => Date;
  }) {
    this.#response = input.response;
    this.#signal = input.signal;
    this.#invocationId = input.invocationId;
    this.#runId = OpaqueIdSchema.parse(input.runId);
    this.#now = input.now;
  }

  static async open(input: {
    response: ServerResponse;
    signal: AbortSignal;
    invocationId: string;
    runId: string;
    now: () => Date;
  }): Promise<LocalExecutionHostEventStream> {
    const stream = new LocalExecutionHostEventStream(input);
    input.response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/event-stream; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    });
    await stream.#write({ kind: 'accepted' });
    return stream;
  }

  publishActivity(activity: unknown): Promise<void> {
    return this.#write({ kind: 'activity', activity });
  }

  async settle(terminal: LocalExecutionHostTerminal): Promise<void> {
    this.#signal.throwIfAborted();
    if (terminal.kind !== 'interrupted') {
      await this.#write(terminal);
    }
    this.#response.end();
  }

  async #write(body: EventBody): Promise<void> {
    this.#signal.throwIfAborted();
    const event = ExecutionHostStreamEventSchema.parse({
      schemaVersion: EXECUTION_CONTRACT_VERSION,
      invocationId: this.#invocationId,
      runId: this.#runId,
      sequence: this.#sequence,
      timestamp: this.#now().toISOString(),
      ...body,
    });
    this.#sequence += 1;
    const frame = [
      `id: ${event.sequence}`,
      `event: ${event.kind}`,
      `data: ${JSON.stringify(event)}`,
      '',
      '',
    ].join('\n');
    if (!this.#response.write(frame)) {
      await once(this.#response, 'drain', { signal: this.#signal });
    }
  }
}

export function parseLocalExecutionHostTerminal(
  value: unknown,
): LocalExecutionHostTerminal {
  return TerminalSchema.parse(value);
}
