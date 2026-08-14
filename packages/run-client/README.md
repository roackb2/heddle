# `@heddleagent/run-client`

Browser-safe, transport-neutral services for consuming a Heddle conversation
run from a browser or JavaScript client.

```bash
npm install @heddleagent/run-client
```

```ts
import {
  ConversationRunConsumerService,
  ConversationRunProtocolCodec,
} from '@heddleagent/run-client'
```

If the adopter uses Heddle's conventional REST/SSE run resource, import the
existing transport client from the optional subpath:

```ts
import { ConversationRunHttpSseClient } from '@heddleagent/run-client/http-sse'
```

## Responsibility boundary

The root entrypoint owns run-envelope validation, JSON safety, accepted
sequence cursors, duplicate and gap handling, terminal detection, and bounded
retry calculation. `/http-sse` adds the existing fetch lifecycle, response
validation, incremental SSE parsing, and event identity checks.

This package does not contain an agent runtime, model providers, Node server,
CLI, React, authentication, authorization, timers, or product UI state. It
remains independent of `@heddleagent/runtime` and requires adopters to supply
their own public event schemas and credentials.

`@roackb2/heddle-remote@5.13.0` remains installable for existing consumers.
Version 6 changes the package coordinate but intentionally preserves the
current feature set and public entrypoints.

See the complete [remote conversation run guide](https://github.com/roackb2/heddle/blob/main/docs/guides/programmatic/remote-runs.md).
