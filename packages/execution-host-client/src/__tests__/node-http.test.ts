import {
  createServer,
  type IncomingMessage,
  type Server,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExecutionHostStreamEvent } from '../contracts/index.js';
import {
  DEFAULT_ADOPTER_CONVERSATION_TURNS_PATH,
  DEFAULT_ADOPTER_JWKS_PATH,
  NodeExecutionAdopterHttpService,
} from '../node/index.js';

const running = new Set<RunningService>();

afterEach(async () => {
  await Promise.all([...running].map((service) => service.close()));
  running.clear();
});

describe('Node execution-adopter HTTP service', () => {
  it('serves JWKS, leaves unknown routes alone, and streams a valid turn', async () => {
    let activeRequest: IncomingMessage | undefined;
    const authenticate = vi.fn((input: { authorization?: string }) => {
      expect(input.authorization).toBe('Bearer user-token');
      expect(activeRequest?.headers.authorization).toBe('[REDACTED]');
      expect(activeRequest?.rawHeaders).not.toContain('Bearer user-token');
      return { subjectId: 'user-a' };
    });
    const service = new NodeExecutionAdopterHttpService({
      authority: {
        publicJwks: () => ({ keys: [{ kty: 'EC', kid: 'key-001' }] }),
      },
      authenticator: { authenticate },
      conversations: {
        streamTurn: async function* ({ principal, prompt }) {
          expect(principal).toEqual({ subjectId: 'user-a' });
          expect(prompt).toBe('Summarize this workspace.');
          yield accepted();
          yield result();
        },
      },
    });
    const app = await start(service, (request) => {
      activeRequest = request;
    });

    const jwks = await fetch(new URL(DEFAULT_ADOPTER_JWKS_PATH, app.baseUrl));
    expect(jwks.status).toBe(200);
    expect(jwks.headers.get('cache-control')).toBe('public, max-age=60');
    await expect(jwks.json()).resolves.toEqual({
      keys: [{ kty: 'EC', kid: 'key-001' }],
    });

    const missing = await fetch(new URL('/product-route', app.baseUrl));
    expect(missing.status).toBe(404);

    const response = await invoke(app.baseUrl, {
      headers: { Authorization: 'Bearer user-token' },
    });
    const stream = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(stream).toContain('event: accepted');
    expect(stream).toContain('event: result');
    expect(authenticate).toHaveBeenCalledOnce();
    expect(JSON.stringify(service)).toBe('{}');
  });

  it('owns safe authentication and request-validation failures', async () => {
    const service = new NodeExecutionAdopterHttpService({
      authority: { publicJwks: () => ({ keys: [] }) },
      authenticator: {
        authenticate: ({ authorization }) => authorization === 'Bearer valid'
          ? { subjectId: 'user-a' }
          : undefined,
      },
      conversations: {
        streamTurn: async function* () {
          yield accepted();
        },
      },
      maxBodyBytes: 64,
    });
    const app = await start(service);

    const unauthenticated = await invoke(app.baseUrl);
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.headers.get('www-authenticate')).toBe('Bearer');

    const wrongMedia = await fetch(
      new URL(DEFAULT_ADOPTER_CONVERSATION_TURNS_PATH, app.baseUrl),
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer valid',
          'Content-Type': 'text/plain',
        },
        body: 'hello',
      },
    );
    expect(wrongMedia.status).toBe(415);

    const oversized = await invoke(app.baseUrl, {
      headers: { Authorization: 'Bearer valid' },
      body: JSON.stringify({ prompt: 'x'.repeat(100) }),
    });
    expect(oversized.status).toBe(413);

    const invalidShape = await invoke(app.baseUrl, {
      headers: { Authorization: 'Bearer valid' },
      body: JSON.stringify({ prompt: 'valid', identity: 'caller-selected' }),
    });
    expect(invalidShape.status).toBe(400);
  });

  it('projects adopter-domain failures without exposing unknown errors', async () => {
    class ProductAuthorizationError extends Error {}
    const secret = 'internal-product-secret';
    const failures: unknown[] = [];
    let attempt = 0;
    const service = new NodeExecutionAdopterHttpService({
      authority: { publicJwks: () => ({ keys: [] }) },
      authenticator: { authenticate: () => ({ subjectId: 'user-a' }) },
      conversations: {
        streamTurn: () => {
          attempt += 1;
          return attempt === 1
            ? failingStream(new ProductAuthorizationError())
            : failingStream(new Error(secret));
        },
      },
      projectError: (error) => error instanceof ProductAuthorizationError
        ? { statusCode: 403, message: 'This action is not allowed.' }
        : undefined,
      reportFailure: (failure) => failures.push(failure),
    });
    const app = await start(service);

    const denied = await invoke(app.baseUrl, {
      headers: { Authorization: 'Bearer valid' },
    });
    expect(denied.status).toBe(403);
    expect(await denied.text()).toContain('This action is not allowed.');

    const failed = await invoke(app.baseUrl, {
      headers: { Authorization: 'Bearer valid' },
    });
    const failedBody = await failed.text();
    expect(failed.status).toBe(502);
    expect(failedBody).toContain('Execution Host conversation failed.');
    expect(failedBody).not.toContain(secret);
    expect(JSON.stringify(failures)).not.toContain(secret);
    expect(failures).toContainEqual({
      phase: 'conversation',
      errorType: 'Error',
      streamAccepted: false,
    });
  });

  it('ends an accepted stream ambiguously when a later failure occurs', async () => {
    const service = new NodeExecutionAdopterHttpService({
      authority: { publicJwks: () => ({ keys: [] }) },
      authenticator: { authenticate: () => ({ subjectId: 'user-a' }) },
      conversations: {
        streamTurn: async function* () {
          yield accepted();
          throw new Error('do-not-reflect');
        },
      },
    });
    const app = await start(service);

    const response = await invoke(app.baseUrl, {
      headers: { Authorization: 'Bearer valid' },
    });
    const stream = await response.text();

    expect(response.status).toBe(200);
    expect(stream).toContain('event: accepted');
    expect(stream).not.toContain('event: error');
    expect(stream).not.toContain('do-not-reflect');
  });

  it('reports an empty host stream as unavailable', async () => {
    const service = new NodeExecutionAdopterHttpService({
      authority: { publicJwks: () => ({ keys: [] }) },
      authenticator: { authenticate: () => ({ subjectId: 'user-a' }) },
      conversations: { streamTurn: async function* () {} },
    });
    const app = await start(service);

    const response = await invoke(app.baseUrl, {
      headers: { Authorization: 'Bearer valid' },
    });

    expect(response.status).toBe(502);
    expect(await response.text()).toContain('returned no events');
  });

  it('aborts active product work during graceful shutdown', async () => {
    let observedAbort = false;
    let enter!: () => void;
    const entered = new Promise<void>((resolve) => { enter = resolve; });
    const service = new NodeExecutionAdopterHttpService({
      authority: { publicJwks: () => ({ keys: [] }) },
      authenticator: { authenticate: () => ({ subjectId: 'user-a' }) },
      conversations: {
        streamTurn: async function* ({ signal }) {
          yield* [] as ExecutionHostStreamEvent[];
          enter();
          await new Promise<void>((resolve) => {
            signal.addEventListener('abort', () => {
              observedAbort = true;
              resolve();
            }, { once: true });
          });
        },
      },
    });
    const app = await start(service);
    const invocation = invoke(app.baseUrl, {
      headers: { Authorization: 'Bearer valid' },
    }).catch((error: unknown) => error);
    await entered;

    await service.close();
    await invocation;

    expect(observedAbort).toBe(true);
  });

  it('validates route and limit configuration once at construction', () => {
    const base = {
      authority: { publicJwks: () => ({ keys: [] }) },
      authenticator: { authenticate: () => undefined },
      conversations: { streamTurn: async function* () {} },
    };

    expect(() => new NodeExecutionAdopterHttpService({
      ...base,
      paths: { jwks: 'relative' },
    })).toThrow(/absolute path/);
    expect(() => new NodeExecutionAdopterHttpService({
      ...base,
      paths: { jwks: '/same', conversationTurns: '/same' },
    })).toThrow(/distinct/);
    expect(() => new NodeExecutionAdopterHttpService({
      ...base,
      maxBodyBytes: 0,
    })).toThrow();
  });
});

type RunningService = {
  baseUrl: URL;
  close(): Promise<void>;
};

async function start(
  service: NodeExecutionAdopterHttpService<unknown>,
  observeRequest?: (request: IncomingMessage) => void,
): Promise<RunningService> {
  const server = createServer((request, response) => {
    observeRequest?.(request);
    if (!service.handle(request, response)) {
      response.writeHead(404).end();
    }
  });
  await listen(server);
  const address = server.address() as AddressInfo;
  const runningService = {
    baseUrl: new URL(`http://127.0.0.1:${address.port}`),
    close: async () => {
      await service.close();
      await closeServer(server);
    },
  };
  running.add(runningService);
  return runningService;
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

function invoke(
  baseUrl: URL,
  options: { headers?: Record<string, string>; body?: string } = {},
): Promise<Response> {
  return fetch(
    new URL(DEFAULT_ADOPTER_CONVERSATION_TURNS_PATH, baseUrl),
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      body: options.body ?? JSON.stringify({
        prompt: 'Summarize this workspace.',
      }),
    },
  );
}

function accepted(): ExecutionHostStreamEvent {
  return {
    schemaVersion: 1,
    invocationId: 'invocation-001',
    runId: 'run-001',
    sequence: 0,
    timestamp: '2026-08-10T12:00:00.000Z',
    kind: 'accepted',
  };
}

function result(): ExecutionHostStreamEvent {
  return {
    schemaVersion: 1,
    invocationId: 'invocation-001',
    runId: 'run-001',
    sequence: 1,
    timestamp: '2026-08-10T12:00:01.000Z',
    kind: 'result',
    result: { outcome: 'done' },
  };
}

async function* failingStream(error: Error): AsyncIterable<
  ExecutionHostStreamEvent
> {
  yield* [] as ExecutionHostStreamEvent[];
  throw error;
}
