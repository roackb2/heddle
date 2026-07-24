import { describe, expect, it, vi } from 'vitest';
import {
  RuntimeSubscriptionOverflowError,
  RuntimeSubscriptionStream,
} from '@/core/runtime/subscriptions/index.js';
import type { RuntimeSubscriptionSink } from '@/core/runtime/subscriptions/index.js';

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

  it('preserves event order at the configured buffer bound', async () => {
    const stream = RuntimeSubscriptionStream.fromSources<number>({
      maxBufferedEvents: 3,
      sources: [
        (sink) => {
          [1, 2, 3].forEach((event) => sink.push(event));
          sink.close();
        },
      ],
    });

    await expect(collect(stream)).resolves.toEqual([1, 2, 3]);
  });

  it('fails a stalled consumer explicitly when its buffer overflows', async () => {
    const cleanup = vi.fn();
    const onOverflow = vi.fn();
    const stream = RuntimeSubscriptionStream.fromSources<string>({
      maxBufferedEvents: 1,
      onOverflow,
      sources: [
        (sink) => {
          sink.push('retained');
          sink.push('overflow');
          return cleanup;
        },
      ],
    });

    await expect(collect(stream)).rejects.toMatchObject({
      name: 'RuntimeSubscriptionOverflowError',
      code: 'RUNTIME_SUBSCRIPTION_OVERFLOW',
      maxBufferedEvents: 1,
      bufferedEvents: 1,
    });
    expect(onOverflow).toHaveBeenCalledWith({
      maxBufferedEvents: 1,
      bufferedEvents: 1,
    });
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('discards buffered events and releases waiters when cancelled', async () => {
    const abort = new AbortController();
    const cleanup = vi.fn();
    const stream = RuntimeSubscriptionStream.fromSources<string>({
      signal: abort.signal,
      sources: [
        (sink) => {
          sink.push('stale');
          return cleanup;
        },
      ],
    });
    const iterator = stream[Symbol.asyncIterator]();

    abort.abort();

    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('isolates fast and slow consumers of the same event source', async () => {
    let fastSink: RuntimeSubscriptionSink<string> | undefined;
    let slowSink: RuntimeSubscriptionSink<string> | undefined;
    const fast = RuntimeSubscriptionStream.fromSources<string>({
      maxBufferedEvents: 1,
      sources: [(sink) => {
        fastSink = sink;
      }],
    });
    const slow = RuntimeSubscriptionStream.fromSources<string>({
      maxBufferedEvents: 1,
      sources: [(sink) => {
        slowSink = sink;
      }],
    });
    const fastIterator = fast[Symbol.asyncIterator]();
    const slowIterator = slow[Symbol.asyncIterator]();

    fastSink?.push('one');
    slowSink?.push('one');
    await expect(fastIterator.next()).resolves.toEqual({ done: false, value: 'one' });

    fastSink?.push('two');
    slowSink?.push('two');
    await expect(fastIterator.next()).resolves.toEqual({ done: false, value: 'two' });
    await expect(slowIterator.next()).rejects.toBeInstanceOf(RuntimeSubscriptionOverflowError);

    fast.close();
    await expect(fastIterator.next()).resolves.toEqual({ done: true, value: undefined });
  });

  it('rejects invalid buffer bounds', () => {
    expect(() => RuntimeSubscriptionStream.fromSources({ maxBufferedEvents: 0 })).toThrow(RangeError);
    expect(() => RuntimeSubscriptionStream.fromSources({ maxBufferedEvents: 1.5 })).toThrow(RangeError);
  });
});

async function collect<Event>(stream: AsyncIterable<Event>): Promise<Event[]> {
  const events: Event[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}
