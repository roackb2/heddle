# `@heddleagent/run-client` 6.0.0

This release moves the existing browser-safe remote-run client from
`@roackb2/heddle-remote` to its final v6 coordinate:

```bash
npm install @heddleagent/run-client
```

The feature set is intentionally unchanged. The root entrypoint still provides
run-envelope validation, cursor/gap/terminal handling, and retry calculation;
`/http-sse` still provides the conventional browser fetch/SSE client.

Existing consumers may continue using `@roackb2/heddle-remote@5.13.0`. The old
package remains installable and is not unpublished.

## Verification

- exact browser-safe dependency and export boundary;
- TypeScript build of the existing implementation; and
- packed-package installation and import from one fresh ESM consumer.
