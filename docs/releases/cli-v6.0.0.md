# `@heddleagent/cli` 6.0.0

This release publishes the existing Heddle coding-agent product under its final
package coordinate:

```bash
npm install --global @heddleagent/cli
heddle --help
```

The feature set is intentionally unchanged: the package ships the `heddle`
command, terminal/TUI workflows, daemon, and local browser control plane. It
depends on `@heddleagent/runtime` for reusable runtime behavior and on
`@heddleagent/run-client` for browser-safe run consumption; it does not contain
a second agent loop.

`@roackb2/heddle@5.13.0` remains installable for existing users and is not
unpublished.

## Verification

- exact CLI dependency and executable boundary;
- TypeScript build from the canonical `src/cli-v2` and `src/client-shared`
  source graph;
- bundled browser control-plane assets; and
- fresh packed installation with `heddle --version` and `heddle daemon --help`
  smoke checks.
