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
  resultArtifacts: {
    auto: {
      minChars: 1200,
      domain: 'document',
      hints: [
        {
          pathIncludes: 'html',
          kind: 'html',
          extension: 'html',
          mimeType: 'text/html',
        },
        {
          pathIncludes: 'source',
          kind: 'source',
          extension: 'md',
          mimeType: 'text/markdown',
        },
      ],
    },
  },
})
```

Automatic capture traverses the MCP result, saves string values at or above the
threshold, and replaces duplicate copies of the same content with the same
artifact reference. Hints classify matching paths; they do not need to describe
every exact response location.

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
