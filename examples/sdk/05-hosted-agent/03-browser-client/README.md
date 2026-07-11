# 03 Browser Client

Follow this optional stage only when the browser consumes the exact REST/SSE
contract from [02 HTTP/SSE API](../02-http-sse-api/). See the
[full hosted-agent walkthrough](../README.md#03-browser-client-protocol-not-product-ui)
for the runnable reconnect/cancel flow.

## Assumptions

- The server exposes the stage-02 routes and public Zod contract.
- The browser can use streaming `fetch` for authenticated SSE.
- The product already has, or will choose, its own UI and state architecture.

## Read in this order

1. [`browser-client.ts`](browser-client.ts) — URL/auth/error/SSE parsing, schema
   validation, cursor validation, and abort propagation.
2. [`run.ts`](run.ts) — application-owned reconnect, terminal-event, and cancel
   policy without a UI framework.

Keep messages, tool rendering, optimistic state, retry UX, notifications, and
product-specific results above this protocol client. A React application should
integrate it with its existing query/state layer rather than adding React state
to this folder.
