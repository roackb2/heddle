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

export type FileArtifactRepositoryOptions = {
  artifactRoot: string;
};

export type ArtifactServiceOptions = FileArtifactRepositoryOptions & {
  now?: () => string;
  nextId?: () => string;
};
