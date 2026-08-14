# `@heddleagent/runtime` 6.0.0

This release publishes Heddle's existing embeddable TypeScript and Node.js SDK
under its final package coordinate:

```bash
npm install @heddleagent/runtime
```

The feature set is intentionally unchanged. The curated SDK remains at the
package root, the former `/hosted` APIs are available as `/runs` and
`/runs/http-sse`, lower-level composition remains at `/advanced`, and heartbeat
store conformance remains at `/heartbeat/testing`.

The package excludes the `heddle` executable, TUI, daemon product lifecycle,
and built browser UI. Those remain in `@roackb2/heddle@5.13.0` until the
separate `@heddleagent/cli` package is released. The old package remains
installable and is not unpublished.

## Verification

- exact runtime-only dependency and export boundary;
- TypeScript build from the existing canonical source graph;
- no copied runtime source and no CLI or browser-product build output; and
- packed-package installation, runtime imports, and public type imports in
  fresh consumers.
