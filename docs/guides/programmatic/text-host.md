# Text Host

`createConversationTextHost` provides default plain-text rendering for
programmatic hosts. It handles assistant stream deltas, activity status lines,
trace labels, compaction status, and final turn summaries.

```ts
import { createConversationTextHost } from '@roackb2/heddle'

const textHost = createConversationTextHost({
  activity: 'status',
  trace: 'off',
  compaction: 'status',
})

const result = await engine.turns.submit({
  sessionId,
  prompt,
  host: textHost.host,
})

textHost.renderTurnResult(result)
```

Pass a custom writer when output should go somewhere other than `stdout`:

```ts
const lines: string[] = []
const textHost = createConversationTextHost({
  output: (text) => lines.push(text),
  trace: 'status',
})
```

Modes:

- `off`: suppress that output category.
- `status`: print compact, human-readable status lines.
- `verbose`: include serialized event payloads where supported.

The text host is generic. Product-specific summaries should be layered on top
of `result.artifacts` and `result.toolResults`.
