# Review

`src/core/review` owns reusable review-domain projections that are not specific
to the CLI, server, or browser UI.

The current boundary is intentionally small:

- `ReviewDiffParser` translates unified Git diff text into Heddle's stable
  review model.
- `types.ts` is the contract consumed by host surfaces and presenters.

Keep host-specific trace reading, HTTP routing, and UI presentation outside
this folder. When adding review behavior here, prefer a class that owns real
translation, aggregation, or policy. Do not add one-line compatibility
functions around class methods.
