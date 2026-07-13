# Turn Results

`engine.turns.submit(...)` and `engine.turns.continue(...)` return a host-facing
turn summary:

```ts
const result = await engine.turns.submit({ sessionId, prompt, host })

console.log(result.outcome)
console.log(result.summary)
console.log(result.failure)
console.log(result.traceFile)
console.log(result.artifacts.map((artifact) => artifact.id))
console.log(result.toolResults.map((entry) => entry.call.tool))
```

Fields:

- `outcome`: why the turn stopped.
- `summary`: persisted assistant summary for the turn.
- `failure`: optional safe structured category for a failed model run. It has
  the shape `{ source: 'model', code }` and never contains credentials or raw
  provider messages. Use this field for stable product behavior instead of
  parsing `summary`.
- `session`: updated persisted session.
- `traceFile`: path to the persisted raw trace file.
- `artifacts`: current artifacts associated with the session.
- `toolResults`: completed tool calls with call input, result, duration, step,
  and timestamp.

Use these fields for product summaries and run artifacts. Reach for raw trace
files only when your host needs lower-level evidence or custom analysis.

For example, a hosted product can translate a rejected user-supplied model
credential into its own API error without coupling to an OpenAI error string:

```ts
if (result.failure?.code === 'authentication') {
  throw new ProductModelCredentialError()
}
```

Quota exhaustion has a separate recovery path from transient rate limiting:

```ts
if (result.failure?.code === 'quota') {
  throw new ProductModelQuotaError()
}
```

`quota` is non-retryable and means the provider reported a structured quota or
billing-capacity failure. `rate_limit` remains retryable. Hosts should map both
from `failure.code`; do not inspect `summary` or raw provider message text.

Model failure codes currently distinguish `authentication`, `permission`,
`quota`, `rate_limit`, `request`, `transport`, `empty_response`, and `unknown`.
