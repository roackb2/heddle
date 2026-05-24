export type RuntimeSubscriptionCleanup = () => void;

// The writable side given to a source callback for one client subscription.
export type RuntimeSubscriptionSink<Event> = {
  push(event: Event): void;
  close(): void;
  addCleanup(cleanup: RuntimeSubscriptionCleanup): void;
};

// A callback-style producer such as an EventEmitter listener, watcher, or timer.
export type RuntimeSubscriptionSource<Event> = (
  sink: RuntimeSubscriptionSink<Event>
) => RuntimeSubscriptionCleanup | void;

// Construction options for one per-client subscription stream.
export type RuntimeSubscriptionStreamArgs<Event> = {
  signal?: AbortSignal;
  sources?: Array<RuntimeSubscriptionSource<Event>>;
};
