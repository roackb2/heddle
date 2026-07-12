import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  ConversationRunHttpSseClient,
  ConversationRunHttpSseClientError,
} from '@/core/chat/remote/http-sse/index.js';
import { ConversationRunProtocolCodec } from '@/core/chat/remote/index.js';

const protocol = new ConversationRunProtocolCodec({
  activity: z.object({ type: z.string() }),
  result: z.object({ summary: z.string() }),
});
const accepted = z.object({ runId: z.string(), accepted: z.literal(true) });
const cancellation = z.object({ cancelled: z.boolean() });

describe('ConversationRunHttpSseClient', () => {
  it('validates start/cancel responses and composes host headers', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse({ runId: 'run-1', accepted: true }, 202))
      .mockResolvedValueOnce(jsonResponse({ cancelled: true }));
    const client = createClient(fetch);

    await expect(client.start({ prompt: 'Hello' })).resolves.toEqual({
      runId: 'run-1',
      accepted: true,
    });
    await expect(client.cancel('run-1')).resolves.toEqual({ cancelled: true });

    expect(fetch).toHaveBeenNthCalledWith(1, 'https://example.test/api/agent/runs', expect.objectContaining({
      method: 'POST',
      body: '{"prompt":"Hello"}',
      headers: expect.any(Headers),
    }));
    const startHeaders = new Headers(fetch.mock.calls[0]?.[1]?.headers);
    expect(startHeaders.get('authorization')).toBe('Bearer test-token');
    expect(startHeaders.get('content-type')).toBe('application/json');
  });

  it('binds the default global fetch for browser-compatible invocation', async () => {
    const fetch = vi.fn(function (this: unknown) {
      if (this !== globalThis) {
        throw new TypeError('Illegal invocation');
      }
      return Promise.resolve(jsonResponse({ runId: 'run-1', accepted: true }, 202));
    }) as unknown as typeof globalThis.fetch;
    vi.stubGlobal('fetch', fetch);

    try {
      const client = new ConversationRunHttpSseClient<
        { prompt: string },
        z.infer<typeof accepted>,
        { type: string },
        { summary: string },
        z.infer<typeof cancellation>
      >({
        baseUrl: 'https://example.test/api/agent/',
        protocol,
        accepted,
        cancellation,
      });

      await expect(client.start({ prompt: 'Hello' })).resolves.toEqual({
        runId: 'run-1',
        accepted: true,
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('parses fragmented SSE and verifies the canonical run identity', async () => {
    const event = {
      kind: 'activity' as const,
      runId: 'run/with space',
      sequence: 3,
      timestamp: '2026-07-12T00:00:00.000Z',
      activity: { type: 'assistant.stream' },
    };
    const frame = `event: activity\nid: 3\ndata: ${protocol.stringifyEvent(event)}\n\n`;
    const midpoint = Math.floor(frame.length / 2);
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(sseResponse([
      frame.slice(0, midpoint),
      frame.slice(midpoint),
    ]));
    const client = createClient(fetch);
    const received: unknown[] = [];

    await client.subscribe({
      runId: 'run/with space',
      afterSequence: 2,
      onEvent: async (item) => {
        await Promise.resolve();
        received.push(item);
      },
    });

    expect(received).toEqual([event]);
    expect(fetch).toHaveBeenCalledWith(
      'https://example.test/api/agent/runs/run%2Fwith%20space/events?after=2',
      expect.objectContaining({ headers: expect.any(Headers) }),
    );
    const headers = new Headers(fetch.mock.calls[0]?.[1]?.headers);
    expect(headers.get('accept')).toBe('text/event-stream');
  });

  it('rejects mismatched payload identity instead of accepting another run', async () => {
    const event = {
      kind: 'result' as const,
      runId: 'another-run',
      sequence: 1,
      timestamp: '2026-07-12T00:00:00.000Z',
      result: { summary: 'Done' },
    };
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(sseResponse([
      `event: result\nid: 1\ndata: ${protocol.stringifyEvent(event)}\n\n`,
    ]));
    const client = createClient(fetch);

    await expect(client.subscribe({
      runId: 'expected-run',
      onEvent: () => undefined,
    })).rejects.toThrow('event belonged to a different run');
  });

  it('cancels the response reader when application event handling fails', async () => {
    const cancel = vi.fn();
    const event = {
      kind: 'activity' as const,
      runId: 'run-1',
      sequence: 1,
      timestamp: '2026-07-12T00:00:00.000Z',
      activity: { type: 'assistant.stream' },
    };
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(
          `event: activity\nid: 1\ndata: ${protocol.stringifyEvent(event)}\n\n`,
        ));
      },
      cancel,
    });
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(stream, {
      headers: { 'Content-Type': 'text/event-stream' },
    }));
    const client = createClient(fetch);

    await expect(client.subscribe({
      runId: 'run-1',
      onEvent: () => {
        throw new Error('render failed');
      },
    })).rejects.toThrow('render failed');
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('normalizes the shared public HTTP error shape', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(jsonResponse({
      error: { code: 'run_conflict', message: 'A run is active.' },
    }, 409));
    const client = createClient(fetch);

    await expect(client.start({ prompt: 'Hello' })).rejects.toEqual(expect.objectContaining({
      name: 'ConversationRunHttpSseClientError',
      status: 409,
      code: 'run_conflict',
      message: 'A run is active.',
    }));
  });

  it('reports invalid successful JSON as a typed transport error', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('not-json', {
      status: 202,
      headers: { 'Content-Type': 'application/json' },
    }));
    const client = createClient(fetch);

    await expect(client.start({ prompt: 'Hello' })).rejects.toEqual(expect.objectContaining({
      name: 'ConversationRunHttpSseClientError',
      status: 202,
      message: 'Conversation run response contained invalid JSON.',
    }));
  });

  it('rejects invalid cursors before making a request', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const client = createClient(fetch);

    await expect(client.subscribe({
      runId: 'run-1',
      afterSequence: -1,
      onEvent: () => undefined,
    })).rejects.toBeInstanceOf(ConversationRunHttpSseClientError);
    expect(fetch).not.toHaveBeenCalled();
  });
});

function createClient(fetch: typeof globalThis.fetch) {
  return new ConversationRunHttpSseClient<
    { prompt: string },
    z.infer<typeof accepted>,
    { type: string },
    { summary: string },
    z.infer<typeof cancellation>
  >({
    baseUrl: 'https://example.test/api/agent/',
    protocol,
    accepted,
    cancellation,
    getHeaders: () => ({ Authorization: 'Bearer test-token' }),
    fetch,
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  }), {
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
  });
}
