# Result Artifacts

Generated source, HTML, JSON, and document bodies can be too large to return
directly to the model. Heddle artifact capture saves those values under the
engine artifact root and replaces the tool result field with a compact artifact
reference.

For MCP host extensions, start with automatic capture:

```ts
const prepared = await prepareMcpHostExtension({
  id: 'document-workspace',
  workspaceRoot,
  stateRoot,
  serverId: 'documents',
  server,
  resultArtifacts: true,
})
```

Automatic capture traverses the MCP result, saves string values at or above the
default threshold, infers common kinds such as HTML and JSON, and replaces
duplicate copies of the same content with the same artifact reference. It also
handles the common MCP shape where `content[0].text` is a JSON serialization of
`structuredContent.result`.

Use auto options only when the host needs to tune generic behavior:

```ts
resultArtifacts: {
  auto: {
    minChars: 1200,
    domain: 'document',
    maxPreviewChars: 800,
  },
}
```

Path hints are advanced overrides. `pathIncludes` means "prefer a result field
whose normalized object path contains this text", such as
`structuredContent.result.html`. Most hosts should not need this.

```ts
resultArtifacts: {
  auto: {
    hints: [{
      pathIncludes: 'markdown',
      kind: 'source',
      extension: 'md',
      mimeType: 'text/markdown',
    }],
  },
}
```

Use manual rules only when the host needs exact control:

```ts
resultArtifacts: {
  rules: [{
    toolName: 'export_document',
    path: 'structuredContent.result.html',
    replacePaths: ['content.0.text'],
    kind: 'html',
    domain: 'document',
    title: 'document-preview.html',
    extension: 'html',
    mimeType: 'text/html',
  }],
}
```

The replacement shape is:

```ts
{
  artifact,
  contentPath,
  preview,
  omittedCharacters,
}
```

The full content remains available through `read_artifact`.
