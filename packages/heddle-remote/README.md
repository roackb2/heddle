# @roackb2/heddle-remote

Browser-safe, transport-neutral services for consuming a remotely hosted
Heddle conversation run.

Install this package in browser applications that should not install Heddle's
Node agent runtime, model providers, server, CLI, or web control plane:

```bash
npm install @roackb2/heddle-remote
```

```ts
import {
  ConversationRunConsumerService,
  ConversationRunProtocolCodec,
} from '@roackb2/heddle-remote'

const protocol = new ConversationRunProtocolCodec({
  activity: PublicActivitySchema,
  result: PublicResultSchema,
})

const consumer = new ConversationRunConsumerService({
  retry: { maxAttempts: 6, baseDelayMs: 500, maxDelayMs: 4_000 },
})
```

If the host uses the conventional REST/SSE run resource, opt into the transport
preset instead of rebuilding fetch and SSE correctness:

```ts
import { ConversationRunHttpSseClient } from '@roackb2/heddle-remote/http-sse'

const client = new ConversationRunHttpSseClient({
  baseUrl: '/api/agent',
  protocol,
  accepted: StartRunResultSchema,
  cancellation: CancelRunResultSchema,
  getHeaders: () => ({ Authorization: `Bearer ${accessToken}` }),
})
```

## Responsibility boundary

The root entrypoint owns the canonical run envelope, runtime wire validation,
JSON-safety, accepted-sequence cursor, duplicate and gap handling, terminal
detection, and bounded retry calculation. The optional `/http-sse` entrypoint
adds conventional run resource paths, fetch lifecycle, response validation,
incremental SSE parsing, and event identity checks.

It does not own tRPC, WebSocket, React, timers, authentication, authorization,
public-field policy, product messages, or UI state. The HTTP/SSE preset also
does not own retry timing or cursor persistence. Hosts must supply Standard
Schema validators whose output contains only the activity and result fields
authorized for remote clients.

The Node host normally combines `@roackb2/heddle` with
`@roackb2/heddle/hosted`. The browser or other remote consumer installs this
package independently.

See the complete [remote conversation run guide](https://github.com/roackb2/heddle/blob/main/docs/guides/programmatic/remote-runs.md).
