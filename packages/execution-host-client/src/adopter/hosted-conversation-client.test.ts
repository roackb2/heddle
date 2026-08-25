import { describe, expect, it } from 'vitest';
import type { ExecutionHostStreamEvent } from '../contracts/index.js';
import {
  ExecutionHostInvocationCancelledError,
  ExecutionHostProtocolError,
  ExecutionHostStreamInterruptedError,
} from '../http-sse/index.js';
import {
  HostedConversationClient,
  HostedConversationClientError,
} from './hosted-conversation-client.js';

const NOW = '2026-08-25T00:00:00.000Z';

describe('HostedConversationClient', () => {
  it('authenticates and validates one ordered terminal stream', async () => {
    const events = [
      event(0, { kind: 'accepted' }),
      event(1, { kind: 'activity', activity: { type: 'tool.calling' } }),
      event(2, {
        kind: 'result',
        result: { outcome: 'done', summary: 'Workspace summary.' },
      }),
    ] satisfies ExecutionHostStreamEvent[];
    let observedInit: RequestInit | undefined;
    const client = new HostedConversationClient({
      fetch: async (_input, init) => {
        observedInit = init;
        return sseResponse(events);
      },
    });

    expect(await collect(client.streamTurn({
      accessToken: 'user-token-value',
      prompt: '  summarize my workspace  ',
    }))).toEqual(events);
    expect(new Headers(observedInit?.headers).get('authorization'))
      .toBe('Bearer user-token-value');
    expect(observedInit?.body).toBe(JSON.stringify({
      prompt: 'summarize my workspace',
    }));
  });

  it('keeps an incomplete stream distinct from invalid protocol', async () => {
    const incomplete = new HostedConversationClient({
      fetch: async () => sseResponse([event(0, { kind: 'accepted' })]),
    });
    const invalid = new HostedConversationClient({
      fetch: async () => sseResponse([
        event(0, { kind: 'accepted' }),
        event(2, {
          kind: 'result',
          result: { outcome: 'done', summary: 'Invalid sequence.' },
        }),
      ]),
    });

    await expect(collect(incomplete.streamTurn(turn())))
      .rejects.toBeInstanceOf(ExecutionHostStreamInterruptedError);
    await expect(collect(invalid.streamTurn(turn())))
      .rejects.toBeInstanceOf(ExecutionHostProtocolError);
  });

  it('projects only the server public rejection message', async () => {
    const client = new HostedConversationClient({
      fetch: async () => new Response(JSON.stringify({
        error: { message: 'Hosted execution is currently unavailable.' },
      }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      }),
    });

    await expect(collect(client.streamTurn(turn())))
      .rejects.toMatchObject({
        name: 'HostedConversationClientError',
        status: 503,
        message: 'Hosted execution is currently unavailable.',
      });
  });

  it('uses a safe fallback for oversized rejection bodies', async () => {
    const client = new HostedConversationClient({
      fetch: async () => new Response('x'.repeat(16_385), { status: 502 }),
    });

    await expect(collect(client.streamTurn(turn())))
      .rejects.toEqual(new HostedConversationClientError(
        'Hosted conversation could not be started.',
        502,
      ));
  });

  it('normalizes caller cancellation to the Execution Host vocabulary', async () => {
    const controller = new AbortController();
    controller.abort();
    const client = new HostedConversationClient();

    await expect(collect(client.streamTurn(turn({
      signal: controller.signal,
    })))).rejects.toBeInstanceOf(ExecutionHostInvocationCancelledError);
  });
});

function turn(
  overrides: Partial<Parameters<HostedConversationClient['streamTurn']>[0]> = {},
): Parameters<HostedConversationClient['streamTurn']>[0] {
  return {
    accessToken: 'user-token-value',
    prompt: 'summarize',
    ...overrides,
  };
}

type EventBody =
  | { kind: 'accepted' }
  | { kind: 'activity'; activity: unknown }
  | { kind: 'result'; result: { outcome: 'done'; summary: string } };

function event(sequence: number, body: EventBody): ExecutionHostStreamEvent {
  return {
    schemaVersion: 1,
    invocationId: 'invocation-1',
    runId: 'run-1',
    sequence,
    timestamp: NOW,
    ...body,
  } as ExecutionHostStreamEvent;
}

function sseResponse(events: ExecutionHostStreamEvent[]): Response {
  return new Response(events.map((item) => [
    `event: ${item.kind}`,
    `id: ${item.sequence}`,
    `data: ${JSON.stringify(item)}`,
    '',
    '',
  ].join('\n')).join(''), {
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
  });
}

async function collect(
  stream: AsyncIterable<ExecutionHostStreamEvent>,
): Promise<ExecutionHostStreamEvent[]> {
  const events: ExecutionHostStreamEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}
