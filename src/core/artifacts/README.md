# Artifacts

The artifacts domain owns Heddle-generated or host-provided output files that
should remain addressable across conversation turns.

Artifacts are not memory, traces, or tool results:

- memory stores durable knowledge for future reasoning;
- traces store evidence of what happened during a run;
- tool results are raw execution outputs;
- artifacts are reusable outputs that a user or host may preview, reopen, or
  ask the agent to modify in a follow-up turn.

This domain owns:

- the `ArtifactRepository` persistence port (catalog document + content blobs);
- the default file-backed implementation: the index at
  `artifactRoot/artifacts.json` and text-like content under
  `artifactRoot/files/`;
- current artifact pointers for a workspace or session;
- repository validation for the persisted JSON contract;
- service operations for save, list, read, and current-artifact selection.

Ownership split inside the domain:

- `ArtifactService` owns artifact policy: id validation, extension resolution,
  catalog shape, and current-pointer semantics. It never touches storage
  directly.
- `ArtifactRepository` (port in `types.ts`) owns persistence. The default is
  `FileArtifactRepository`; hosted services inject their own implementation via
  `createConversationEngine({ artifactRepository })`, and it flows to the
  engine artifact reader, turn-result listing, and artifact tools.
- `RuntimeArtifact.path` stores the repository-owned content key: an absolute
  file path for the file store, an opaque key for custom stores.

This domain does not own:

- UI preview rendering;
- domain-specific parsing such as presentation source analysis;
- automatic promotion of arbitrary tool results into artifacts;
- runtime tool exposure for artifact operations.

Those behaviors should depend on this service boundary instead of reading or
writing artifact files directly.
