import { describe, expect, it, vi } from 'vitest';
import { RuntimeSubscriptionStream } from '@/core/runtime/subscriptions/index.js';

describe('RuntimeSubscriptionStream', () => {
  it('buffers source events until a subscription reader asks for them', async () => {
    const stream = RuntimeSubscriptionStream.fromSources<string>({
      sources: [
        (sink) => {
          sink.push('ready');
          sink.push('updated');
        },
      ],
    });
    const iterator = stream[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toEqual({ done: false, value: 'ready' });
    await expect(iterator.next()).resolves.toEqual({ done: false, value: 'updated' });

    stream.close();
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
  });

  it('wakes pending readers and runs source cleanup when aborted', async () => {
    const abort = new AbortController();
    const cleanup = vi.fn();
    const stream = RuntimeSubscriptionStream.fromSources<string>({
      signal: abort.signal,
      sources: [
        () => cleanup,
      ],
    });
    const iterator = stream[Symbol.asyncIterator]();
    const waiting = iterator.next();

    abort.abort();

    await expect(waiting).resolves.toEqual({ done: true, value: undefined });
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('runs cleanups once when the consumer stops iterating', async () => {
    const cleanup = vi.fn();
    const stream = RuntimeSubscriptionStream.fromSources<string>({
      sources: [
        (sink) => {
          sink.push('ready');
          return cleanup;
        },
      ],
    });
    const iterator = stream[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toEqual({ done: false, value: 'ready' });
    await iterator.return?.();
    stream.close();

    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});
