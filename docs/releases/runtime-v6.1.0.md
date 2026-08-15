# `@heddleagent/runtime` 6.1.0

This release adds the package-to-package `/cli` bridge used by the official
Heddle coding-agent product:

```ts
import { RuntimeHostResolver } from '@heddleagent/runtime/cli'
```

The bridge exposes the existing runtime and embeddable control-plane services
needed by `@heddleagent/cli`; it does not introduce another agent loop or copy
runtime implementation into the CLI package. Product applications should
continue to use the curated root, `/runs`, or `/advanced` entrypoints.

All existing runtime behavior and entrypoints remain available. The former
`@roackb2/heddle@5.13.0` package remains installable during migration.

## Verification

- exact runtime manifest and `/cli` export boundary;
- TypeScript build from the canonical runtime source graph; and
- packed-package installation plus runtime and type imports in fresh consumers.
