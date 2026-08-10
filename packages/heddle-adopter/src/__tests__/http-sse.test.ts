import { describe, expect, it } from 'vitest';
import {
  DirectHttpExecutionHost,
  ExecutionHostInvocationCancelledError,
  ExecutionHostProtocolError,
  ExecutionHostRejectedError,
  ExecutionHostStreamInterruptedError,
  type ExecutionHostConversationTurn,
} from '../http-sse/index.js';
import type { ExecutionHostStreamEvent } from '../contracts/index.js';

const INVOCATION_ID = 'invocation-001';
const RUN_ID = 'run-001';
const TIMESTAMP = '2026-08-10T05:00:00.000Z';

describe('direct HTTP/SSE Execution Host adapter', () => {
  it('places authority only in headers and validates a complete stream', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const host = createHost(sseResponse([accepted(), activity(1), result(2)]), requests);
    const events = await collect(host.streamConversationTurn(input()));

    expect(events).toEqual([accepted(), activity(1), result(2)]);
    expect(requests[0]!.url).toBe('http://127.0.0.1:8080/invocations');
    const request = requests[0]!.init!;
    const headers = new Headers(request.headers);
    expect(headers.get('x-amzn-bedrock-agentcore-runtime-session-id'))
      .toBe(runtimeSessionId());
    expect(headers.get('x-heddle-execution-host-local-token'))
      .toBe('local-runtime-token');
    expect(headers.get('x-heddle-execution-host-model-api-key'))
      .toBe('model-api-key');
    expect(headers.get('x-heddle-execution-host-assertion'))
      .toBe('execution-assertion'.padEnd(32, 'x'));
    expect(headers.get('x-heddle-execution-host-mcp-capability'))
      .toBe('mcp-capability'.padEnd(32, 'x'));
    expect(request.redirect).toBe('error');
    expect(JSON.parse(String(request.body))).toEqual({
      schemaVersion: 1,
      kind: 'conversation-turn',
      invocationId: INVOCATION_ID,
      prompt: 'Summarize the current product state.',
    });
    expect(String(request.body)).not.toContain('assertion');
    expect(String(request.body)).not.toContain('model-api-key');
  });

  it('streams non-terminal events but withholds terminal until clean EOF', async () => {
    let close!: () => void;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sse([accepted(), activity(1), result(2)])));
        close = () => controller.close();
      },
    });
    const host = createHost(new Response(body, {
      headers: { 'content-type': 'text/event-stream' },
    }));
    const iterator = host.streamConversationTurn(input())[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toEqual({ value: accepted(), done: false });
    await expect(iterator.next()).resolves.toEqual({ value: activity(1), done: false });
    const terminal = iterator.next();
    let settled = false;
    void terminal.finally(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    close();
    await expect(terminal).resolves.toEqual({ value: result(2), done: false });
  });

  it('rejects a post-terminal frame without projecting terminal success', async () => {
    const host = createHost(sseResponse([accepted(), result(1), activity(2)]));
    const observed: ExecutionHostStreamEvent[] = [];
    await expect(async () => {
      for await (const event of host.streamConversationTurn(input())) {
        observed.push(event);
      }
    }).rejects.toBeInstanceOf(ExecutionHostProtocolError);
    expect(observed).toEqual([accepted()]);
  });

  it('bounds frames accumulated from one hostile response chunk', async () => {
    const events = [
      accepted(),
      ...Array.from({ length: 1_025 }, (_, index) => activity(index + 1)),
    ];
    const host = createHost(sseResponse(events));

    await expect(collect(host.streamConversationTurn(input())))
      .rejects.toBeInstanceOf(ExecutionHostProtocolError);
  });

  it.each([
    ['missing terminal', [accepted(), activity(1)], ExecutionHostStreamInterruptedError],
    ['wrong invocation', [accepted(), { ...result(1), invocationId: 'other' }], ExecutionHostProtocolError],
    ['wrong run', [accepted(), { ...result(1), runId: 'other' }], ExecutionHostProtocolError],
    ['sequence gap', [accepted(), activity(2)], ExecutionHostProtocolError],
    ['missing accepted', [activity(0), result(1)], ExecutionHostProtocolError],
  ])('rejects %s', async (_label, events, ErrorType) => {
    const host = createHost(sseResponse(events as ExecutionHostStreamEvent[]));
    await expect(collect(host.streamConversationTurn(input())))
      .rejects.toBeInstanceOf(ErrorType);
  });

  it('projects only a bounded safe rejection code', async () => {
    const rejected = createHost(new Response(JSON.stringify({
      error: { code: 'invalid_execution_identity', message: 'secret detail' },
    }), { status: 401 }));
    await expect(collect(rejected.streamConversationTurn(input())))
      .rejects.toEqual(new ExecutionHostRejectedError(
        401,
        'invalid_execution_identity',
      ));

    const oversized = createHost(new Response('x'.repeat(16_385), {
      status: 502,
    }));
    await expect(collect(oversized.streamConversationTurn(input())))
      .rejects.toEqual(new ExecutionHostRejectedError(502, 'unknown'));

    const controlText = createHost(new Response(JSON.stringify({
      error: { code: 'unsafe\ncode', message: 'detail' },
    }), { status: 401 }));
    await expect(collect(controlText.streamConversationTurn(input())))
      .rejects.toEqual(new ExecutionHostRejectedError(401, 'unknown'));
  });

  it('normalizes cancellation without calling the host', async () => {
    let called = false;
    const host = new DirectHttpExecutionHost({
      baseUrl: new URL('http://127.0.0.1:8080'),
      localToken: 'local-runtime-token',
      fetch: (async () => {
        called = true;
        return sseResponse([accepted(), result(1)]);
      }) as typeof fetch,
    });
    const controller = new AbortController();
    controller.abort();
    await expect(collect(host.streamConversationTurn(input({
      signal: controller.signal,
    })))).rejects.toBeInstanceOf(ExecutionHostInvocationCancelledError);
    expect(called).toBe(false);
  });

  it('rejects unsafe URLs while supporting loopback IPv6 and path prefixes', async () => {
    expect(() => new DirectHttpExecutionHost({
      baseUrl: new URL('https://user:secret@example.test'),
      localToken: 'local-runtime-token',
    })).toThrow(/contain no credentials/);
    expect(() => new DirectHttpExecutionHost({
      baseUrl: new URL('http://example.test'),
      localToken: 'local-runtime-token',
    })).toThrow(/HTTPS or loopback HTTP/);
    expect(() => new DirectHttpExecutionHost({
      baseUrl: new URL('http://[::1]:8080'),
      localToken: 'local-runtime-token',
    })).not.toThrow();

    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const prefixed = new DirectHttpExecutionHost({
      baseUrl: new URL('https://host.example.test/agent/'),
      localToken: 'local-runtime-token',
      fetch: (async (url, init) => {
        requests.push({ url: String(url), init });
        return sseResponse([accepted(), result(1)]);
      }) as typeof fetch,
    });
    await collect(prefixed.streamConversationTurn(input()));
    expect(requests[0]!.url).toBe('https://host.example.test/agent/invocations');
  });

  it('copies and hides its local credential', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const config = {
      baseUrl: new URL('http://127.0.0.1:8080'),
      localToken: 'original-local-runtime-token',
      fetch: (async (url: URL | RequestInfo, init?: RequestInit) => {
        requests.push({ url: String(url), init });
        return sseResponse([accepted(), result(1)]);
      }) as typeof fetch,
    };
    const host = new DirectHttpExecutionHost(config);
    config.localToken = 'caller-mutated-token';
    await collect(host.streamConversationTurn(input({ mcpCapability: undefined })));

    const headers = new Headers(requests[0]!.init!.headers);
    expect(headers.get('x-heddle-execution-host-local-token'))
      .toBe('original-local-runtime-token');
    expect(headers.has('x-heddle-execution-host-mcp-capability')).toBe(false);
    expect(JSON.stringify(host)).toBe('{}');
    expect(JSON.stringify(host)).not.toContain('original-local-runtime-token');
  });
});

function createHost(
  response: Response,
  requests: Array<{ url: string; init?: RequestInit }> = [],
): DirectHttpExecutionHost {
  return new DirectHttpExecutionHost({
    baseUrl: new URL('http://127.0.0.1:8080'),
    localToken: 'local-runtime-token',
    fetch: (async (url, init) => {
      requests.push({ url: String(url), init });
      return response;
    }) as typeof fetch,
  });
}

function input(
  overrides: Partial<ExecutionHostConversationTurn> = {},
): ExecutionHostConversationTurn {
  return {
    invocationId: INVOCATION_ID,
    runtimeSessionId: runtimeSessionId(),
    prompt: 'Summarize the current product state.',
    executionAssertion: 'execution-assertion'.padEnd(32, 'x'),
    mcpCapability: 'mcp-capability'.padEnd(32, 'x'),
    modelApiKey: 'model-api-key',
    ...overrides,
  };
}

function runtimeSessionId(): string {
  return 'runtime-session-'.padEnd(33, 's');
}

function accepted(): ExecutionHostStreamEvent {
  return envelope({ sequence: 0, kind: 'accepted' });
}

function activity(sequence: number): ExecutionHostStreamEvent {
  return envelope({
    sequence,
    kind: 'activity',
    activity: { type: 'assistant_text_delta', text: 'working' },
  });
}

function result(sequence: number): ExecutionHostStreamEvent {
  return envelope({
    sequence,
    kind: 'result',
    result: { outcome: 'done', summary: 'complete' },
  });
}

function envelope<T extends object>(event: T): T & {
  schemaVersion: 1;
  invocationId: string;
  runId: string;
  timestamp: string;
} {
  return {
    schemaVersion: 1,
    invocationId: INVOCATION_ID,
    runId: RUN_ID,
    timestamp: TIMESTAMP,
    ...event,
  };
}

function sseResponse(events: ExecutionHostStreamEvent[]): Response {
  return new Response(sse(events), {
    headers: { 'content-type': 'text/event-stream; charset=utf-8' },
  });
}

function sse(events: ExecutionHostStreamEvent[]): string {
  return events.map((event) => [
    `id: ${event.sequence}`,
    `event: ${event.kind}`,
    `data: ${JSON.stringify(event)}`,
    '',
    '',
  ].join('\n')).join('');
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
