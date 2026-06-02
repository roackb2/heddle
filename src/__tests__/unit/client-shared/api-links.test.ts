import { afterEach, describe, expect, it, vi } from 'vitest';
import { createControlPlaneRequestFetch } from '@/client-shared/api/links';

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
});
