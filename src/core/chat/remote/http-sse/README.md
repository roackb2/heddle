# Remote HTTP/SSE Client

`src/core/chat/remote/http-sse` is the browser-safe REST/SSE preset above the
transport-neutral remote run protocol.

## Owns

- the conventional `/runs` start, event, and cancel resource paths;
- injected authentication headers and `fetch`;
- accepted/cancel response validation through host-supplied Standard Schemas;
- incremental SSE parsing and reader cleanup;
- content-type, run ID, SSE event name, and SSE ID verification;
- normalized HTTP errors for the shared `{ error: { code, message } }` shape.

## Does not own

- authentication or authorization policy;
- product request, activity, and result schemas;
- retry timing, cursor persistence, or duplicate/gap handling, which remain in
  `ConversationRunConsumerService`;
- messages, tool rendering, optimistic state, React, or another UI framework;
- a server implementation or deployment policy.

Import this opt-in assumption layer from `@roackb2/heddle-remote/http-sse`.
Use the root `@roackb2/heddle-remote` entrypoint when the host owns another
transport such as tRPC, WebSocket, or a native bridge.
