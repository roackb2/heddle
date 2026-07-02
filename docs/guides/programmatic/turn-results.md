# Turn Results

`engine.turns.submit(...)` and `engine.turns.continue(...)` return a host-facing
turn summary:

```ts
const result = await engine.turns.submit({ sessionId, prompt, host })

console.log(result.outcome)
console.log(result.summary)
console.log(result.traceFile)
console.log(result.artifacts.map((artifact) => artifact.id))
console.log(result.toolResults.map((entry) => entry.call.tool))
```

Fields:

- `outcome`: why the turn stopped.
- `summary`: persisted assistant summary for the turn.
- `session`: updated persisted session.
- `traceFile`: path to the persisted raw trace file.
- `artifacts`: current artifacts associated with the session.
- `toolResults`: completed tool calls with call input, result, duration, step,
  and timestamp.

Use these fields for product summaries and run artifacts. Reach for raw trace
files only when your host needs lower-level evidence or custom analysis.
