# Conversation Run Stream Client State

This service owns frontend-neutral cursor and reconnect semantics for the
control plane's run-addressed stream.

## Owns

- selecting one accepted run identity;
- advancing the canonical sequence cursor;
- suppressing replayed duplicates;
- detecting sequence gaps;
- recognizing result, cancellation, and error terminals;
- bounded exponential reconnect timing from the latest accepted sequence.

## Does not own

- tRPC, React Query, EventSource, timers, or subscription handles;
- CLI/Ink or browser/React state;
- conversation activity presentation;
- server run coordination or replay storage.

CLI-v2 and web-v2 each own their transport lifecycle but must use this service
for cursor correctness so Heddle's interfaces behave like SDK-built hosts.
