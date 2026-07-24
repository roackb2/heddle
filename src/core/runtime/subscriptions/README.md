# Runtime Subscriptions

`src/core/runtime/subscriptions` owns the host-facing push-to-`AsyncIterable`
transport primitive used by control-plane subscriptions.

The service intentionally does not know about tRPC, SSE, conversation activity,
heartbeat task records, or session metadata. Callers provide event sources such
as an `EventEmitter` listener, a file watcher, or an interval; the stream owns
bounded buffering, waiter wakeups, abort handling, and cleanup.

Use this when a host needs to bridge callback-style runtime/server events into
a subscription transport. Keep domain vocabulary and event projection in the
calling controller or domain service.

## How It Works

Each client subscription gets its own `RuntimeSubscriptionStream` instance. The
stream starts one or more source callbacks and gives each source a `sink`.

`sink` means "the writable end of this subscription." A source calls
`sink.push(event)` when it receives an event, `sink.addCleanup(cleanup)` when it
registers a listener/timer/watcher that must be released, and `sink.close()`
when that source knows the subscription should stop.

The stream itself is the readable end. tRPC consumes it as an `AsyncIterable`:

```text
event source callback -> sink.push(event) -> stream buffer/waiter -> for await
```

If the client is already waiting for the next event, `push` wakes that reader.
If the client is busy, `push` buffers the event until the reader asks again.
Each stream retains at most `maxBufferedEvents` payloads (256 by default).
Exceeding that bound fails the iterator with
`RuntimeSubscriptionOverflowError`, releases the queued payloads and source
resources, and invokes the optional `onOverflow` observation hook. Hosts should
record that hook in their metrics or tracing system.

Overflow never drops events while pretending the subscription is complete.
When a source has durable replay, the client reconnects from its last consumed
cursor. Conversation-run streams provide this through `afterSequence`; their
bounded replay window can reject an older cursor explicitly. Sources without
durable replay should treat overflow as an invalidation signal and refetch
their canonical query before opening a new live subscription.

When the browser aborts the request or the consumer stops iterating, the stream
discards queued events, runs registered cleanups, and wakes any pending reader
so the subscription can finish without retaining payloads or listeners.

## Fanout

Fanout belongs to the event source, not this primitive. For example,
`ControlPlaneChatSessionsController` publishes live session events to an
`EventEmitter` keyed by session id. If web-v2 and a future TUI both subscribe to
the same session through tRPC, each interface creates its own tRPC subscription,
each subscription creates its own `RuntimeSubscriptionStream`, and each stream
registers its own listener on the same event bus key.

```text
publisher.emit(sessionId, event)
  -> web stream listener -> web tRPC subscription
  -> TUI stream listener -> TUI tRPC subscription
```

Each subscriber has an independent bound, so one stalled client can overflow
and disconnect without slowing or corrupting another subscriber. No change is
needed in this primitive for that fanout model. Shared delivery guarantees,
durable replay, and cross-process distribution remain event-source
responsibilities rather than per-subscription buffer mechanics.
