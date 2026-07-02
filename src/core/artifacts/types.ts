export type ArtifactKind =
  | 'source'
  | 'html'
  | 'json'
  | 'image'
  | 'document'
  | 'binary'
  | 'domain';

export type RuntimeArtifact = {
  id: string;
  kind: ArtifactKind;
  domain?: string;
  title?: string;
  path: string;
  mimeType?: string;
  sessionId?: string;
  turnId?: string;
  sourceTool?: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
};

export type ArtifactCurrentPointers = {
  workspaceArtifactId?: string;
  sessionArtifactIds: Record<string, string>;
};

export type ArtifactStore = {
  version: 1;
  artifacts: RuntimeArtifact[];
  current: ArtifactCurrentPointers;
};

export type ArtifactListOptions = {
  sessionId?: string;
  domain?: string;
  kind?: ArtifactKind;
};

export type SaveTextArtifactInput = {
  content: string;
  kind: ArtifactKind;
  domain?: string;
  title?: string;
  extension?: string;
  mimeType?: string;
  sessionId?: string;
  turnId?: string;
  sourceTool?: string;
  metadata?: Record<string, unknown>;
  setCurrent?: boolean;
};

export type ArtifactReadResult = {
  artifact: RuntimeArtifact;
  content: string;
};

/**
 * Persistence port for the artifacts domain: the catalog document plus
 * text-like content blobs. `ArtifactService` owns artifact policy (ids,
 * extensions, current-pointer semantics) and delegates ALL persistence here,
 * so a host can back artifacts with its own storage (database, object store,
 * in-memory) by implementing this contract.
 *
 * Content addressing: the repository owns key generation via `contentKey`.
 * The returned key is stored as `RuntimeArtifact.path` — an absolute file
 * path for the default file-backed store, an opaque storage key for custom
 * stores.
 */
export type ArtifactRepository = {
  readCatalog(): ArtifactStore;
  writeCatalog(store: ArtifactStore): void;
  contentKey(id: string, extension: string): string;
  contentExists(key: string): boolean;
  writeContent(key: string, content: string): void;
  readContent(key: string): string | undefined;
};

export type FileArtifactRepositoryOptions = {
  artifactRoot: string;
};

export type ArtifactServiceOptions = {
  /** Root for the default file-backed repository. Ignored when `repository` is provided. */
  artifactRoot?: string;
  /** Custom persistence implementation. Wins over `artifactRoot`. */
  repository?: ArtifactRepository;
  now?: () => string;
  nextId?: () => string;
};
