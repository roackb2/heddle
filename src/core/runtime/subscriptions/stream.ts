import type {
  RuntimeSubscriptionCleanup,
  RuntimeSubscriptionSink,
  RuntimeSubscriptionSource,
  RuntimeSubscriptionStreamArgs,
} from './types.js';

const CLOSED = Symbol('runtime-subscription-closed');

/**
 * Push-to-AsyncIterable bridge for host subscription transports.
 *
 * Event sources push payloads through the sink while the stream owns buffering,
 * waiter wakeups, abort propagation, and source cleanup. It deliberately does
 * not inspect event payloads.
 */
export class RuntimeSubscriptionStream<Event> implements AsyncIterable<Event> {
  private readonly events: Event[] = [];
  private readonly waiters: Array<(event: Event | typeof CLOSED) => void> = [];
  private readonly cleanups: RuntimeSubscriptionCleanup[] = [];
  private readonly abortSignal?: AbortSignal;
  private readonly abort = () => this.close();
  private closed = false;

  // Convenience constructor for controllers that create a stream from several
  // callback-style sources in one expression.
  static fromSources<Event>(args: RuntimeSubscriptionStreamArgs<Event> = {}): RuntimeSubscriptionStream<Event> {
    return new RuntimeSubscriptionStream(args);
  }

  // Starts the stream and attaches abort handling. Sources are registered
  // immediately so callers can return the stream directly to tRPC.
  constructor(args: RuntimeSubscriptionStreamArgs<Event> = {}) {
    this.abortSignal = args.signal;
    this.abortSignal?.addEventListener('abort', this.abort, { once: true });
    if (this.abortSignal?.aborted) {
      this.close();
      return;
    }

    args.sources?.forEach((source) => this.addSource(source));
  }

  // The sink is the writable side passed to sources. Sources push events and
  // register cleanup without seeing the stream's internal buffers or waiters.
  get sink(): RuntimeSubscriptionSink<Event> {
    return {
      push: (event) => this.push(event),
      close: () => this.close(),
      addCleanup: (cleanup) => this.addCleanup(cleanup),
    };
  }

  // Registers one event source for this client subscription. If the source
  // returns a cleanup function, the stream will run it on close.
  addSource(source: RuntimeSubscriptionSource<Event>): void {
    if (this.closed) {
      return;
    }

    const cleanup = source(this.sink);
    if (cleanup) {
      this.addCleanup(cleanup);
    }
  }

  // Adds cleanup for resources opened after source registration, such as a
  // lazily-created watcher or listener.
  addCleanup(cleanup: RuntimeSubscriptionCleanup): void {
    if (this.closed) {
      this.runCleanup(cleanup);
      return;
    }

    this.cleanups.push(cleanup);
  }

  // Delivers an event to the next waiting reader, or buffers it if the reader
  // has not asked for the next item yet.
  push(event: Event): void {
    if (this.closed) {
      return;
    }

    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(event);
      return;
    }

    this.events.push(event);
  }

  // Stops accepting new events, removes abort handling, runs source cleanups,
  // and wakes pending readers so the AsyncIterator can finish.
  close(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.abortSignal?.removeEventListener('abort', this.abort);
    this.cleanups.splice(0).reverse().forEach((cleanup) => this.runCleanup(cleanup));
    this.waiters.splice(0).forEach((waiter) => waiter(CLOSED));
  }

  // Lets tRPC consume the stream with `for await`. The iterator drains buffered
  // events first, then waits for future pushes until the stream closes.
  async *[Symbol.asyncIterator](): AsyncIterator<Event> {
    try {
      while (!this.closed || this.events.length > 0) {
        const event = this.events.length > 0
          ? this.events.shift() as Event
          : await new Promise<Event | typeof CLOSED>((resolve) => {
            this.waiters.push(resolve);
          });
        if (event === CLOSED) {
          break;
        }

        yield event;
      }
    } finally {
      this.close();
    }
  }

  // Runs one cleanup defensively so a failed listener/timer cleanup does not
  // prevent the rest of the subscription from closing.
  private runCleanup(cleanup: RuntimeSubscriptionCleanup): void {
    try {
      cleanup();
    } catch {
      // Cleanup runs during subscription shutdown. Continue closing the stream
      // so one failed source cleanup cannot leave readers hanging.
    }
  }
}
