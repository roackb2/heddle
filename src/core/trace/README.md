# Trace

`src/core/trace` owns the low-level trace event buffer and console formatting.

- `TraceRecorder` accumulates events for one run.
- `TraceConsoleFormatter` renders raw trace events for terminal-style output.

Keep higher-level projection, activity summaries, and review evidence outside
this folder. Those belong in `src/core/observability` and `src/core/review`.
