# Hosted HTTP/SSE Transport

`src/core/chat/runs/http-sse` is the opt-in Node HTTP/SSE assumption layer for
hosted conversation runs.

## Owns

- strict replay cursor parsing with query-over-header precedence;
- Node HTTP SSE headers and canonical `event`, `id`, and JSON `data` frames;
- response backpressure;
- request-abort and response-close subscription cleanup;
- ending an opened stream on completion or failure.

## Does not own

- route registration or a server framework;
- authentication, authorization, CORS, payload limits, rate limits, or public
  error policy;
- run lookup, replay, cancellation, or result projection;
- cross-process event delivery or durable replay.

The helper accepts Node `IncomingMessage` and `ServerResponse`, so Express,
Fastify, Nest, and other Node server adapters can use it without making Heddle
depend on those frameworks. Import it from `@roackb2/heddle/hosted/http-sse`.
