# External-context tools

This toolkit owns provider-backed reads of information that is outside the
runtime workspace. `web_search` returns a bounded cited summary;
`view_image` describes supported local images or host-authorized image content.
It does not own product authorization, object storage, provenance persistence,
or decisions about which references a user may access.

## Public contracts

The advanced entrypoint exports canonical Zod schemas and inferred types for
both tools. The tool definitions expose those same schemas through
`inputSchema` / `outputSchema`, and every execution validates with them. A host
that wraps a tool to persist citations or project results should import these
contracts rather than recreate their shapes.

`view_image` keeps its local `path` / `paths` input. A hosted product can also
configure `resourceResolver` and expose opaque `reference` / `references`
values to the model:

```ts
const imageTool = createViewImageTool({
  ...runtimeContext,
  resourceResolver: async (reference, { signal }) => {
    const authorized = await productStore.readAuthorized(reference, signal);
    return authorized && {
      bytes: authorized.body,
      mediaType: authorized.mediaType,
      byteSize: authorized.byteSize,
      checksumSha256: authorized.checksumSha256,
    };
  },
});
```

The resolver is the authorization boundary. A missing result is treated as
unavailable or unauthorized without widening access. Heddle validates the
media type, reads no more than `maxImageBytes` (20 MiB by default), honors the
run cancellation signal, checks optional byte-count/SHA-256 metadata, and sends
the in-memory content to the selected provider without a temporary file.

## Request-scoped credentials

Do not resolve provider credentials in an adopter toolkit. Pass that toolkit to
`AgentLoopRuntimeService.run({ toolkits: [...] })`; Heddle acquires one
request-scoped credential and invokes `createTools(context)` with the same
resolved context used for the run. This works with `includeDefaultTools: false`
for exact, bounded tool sets.

