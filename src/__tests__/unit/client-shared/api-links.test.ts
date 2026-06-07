import { afterEach, describe, expect, it, vi } from 'vitest';
import { observable, observableToPromise } from '@trpc/server/observable';
import {
  createControlPlaneRequestContext,
  createControlPlaneRequestFetch,
  createControlPlaneRequestTimeoutLink,
} from '@/client-shared/api/links';

describe('control-plane API links', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('aborts request/response calls that exceed the configured timeout', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
    }));
    const requestFetch = createControlPlaneRequestFetch({ fetchImpl, timeoutMs: 25 });

    const request = requestFetch('http://127.0.0.1:8765/trpc/controlPlane.state');
    const assertion = expect(request).rejects.toThrow('Control-plane request timed out after 25ms.');

    await vi.advanceTimersByTimeAsync(25);
    await assertion;
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:8765/trpc/controlPlane.state',
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('preserves caller aborts when tRPC cancels a request', async () => {
    const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
    }));
    const requestFetch = createControlPlaneRequestFetch({ fetchImpl, timeoutMs: 30_000 });
    const controller = new AbortController();

    const request = requestFetch('http://127.0.0.1:8765/trpc/controlPlane.state', {
      signal: controller.signal,
    });
    controller.abort(new Error('Caller cancelled request.'));

    await expect(request).rejects.toThrow('Caller cancelled request.');
  });

  it('times out tRPC operations at the default request budget', async () => {
    vi.useFakeTimers();
    const request = runNeverCompletingOperation({
      defaultTimeoutMs: 25,
      context: {},
    });
    const assertion = expect(request).rejects.toThrow('Control-plane request "controlPlane.state" timed out after 25ms.');

    await vi.advanceTimersByTimeAsync(25);
    await assertion;
  });

  it('uses per-operation timeout context when provided', async () => {
    vi.useFakeTimers();
    let settled = false;
    const request = runNeverCompletingOperation({
      defaultTimeoutMs: 25,
      context: createControlPlaneRequestContext({ timeoutMs: 75 }),
    }).finally(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(25);
    await Promise.resolve();
    expect(settled).toBe(false);

    const assertion = expect(request).rejects.toThrow('Control-plane request "controlPlane.state" timed out after 75ms.');
    await vi.advanceTimersByTimeAsync(50);
    await assertion;
  });
});

function runNeverCompletingOperation({
  context,
  defaultTimeoutMs,
}: {
  context: Record<string, unknown>;
  defaultTimeoutMs: number;
}) {
  const link = createControlPlaneRequestTimeoutLink({ defaultTimeoutMs })({});
  return observableToPromise(link({
    op: {
      id: 1,
      type: 'query',
      path: 'controlPlane.state',
      input: undefined,
      context,
      signal: undefined,
    },
    next: () => observable(() => undefined),
  }));
}
