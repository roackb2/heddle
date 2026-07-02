import { randomUUID } from 'node:crypto';
import { basename, extname, relative, resolve } from 'node:path';
import dayjs from 'dayjs';
import { FileArtifactRepository } from './repository.js';
import type {
  ArtifactKind,
  ArtifactListOptions,
  ArtifactReadResult,
  ArtifactRepository,
  ArtifactServiceOptions,
  ArtifactStore,
  RuntimeArtifact,
  SaveTextArtifactInput,
} from './types.js';

const KIND_EXTENSION: Record<ArtifactKind, string> = {
  source: 'txt',
  html: 'html',
  json: 'json',
  image: 'bin',
  document: 'txt',
  binary: 'bin',
  domain: 'txt',
};

/**
 * Owns artifact policy: id validation, extension resolution, catalog shape,
 * and current-artifact selection. All persistence goes through the
 * `ArtifactRepository` port (file-backed by default), so hosts can supply
 * their own storage.
 */
export class ArtifactService {
  private readonly repository: ArtifactRepository;
  private readonly now: () => string;
  private readonly nextId: () => string;

  constructor(options: ArtifactServiceOptions) {
    this.repository = ArtifactService.resolveRepository(options);
    this.now = options.now ?? (() => dayjs().toISOString());
    this.nextId = options.nextId ?? (() => `artifact-${randomUUID()}`);
  }

  saveText(input: SaveTextArtifactInput): RuntimeArtifact {
    const id = this.assertArtifactId(this.nextId());
    const timestamp = this.now();
    const path = this.repository.contentKey(id, this.resolveExtension(input));
    if (this.get(id) || this.repository.contentExists(path)) {
      throw new Error(`Artifact already exists: ${id}`);
    }

    const artifact: RuntimeArtifact = {
      id,
      kind: input.kind,
      path,
      createdAt: timestamp,
      updatedAt: timestamp,
      ...(input.domain ? { domain: input.domain } : {}),
      ...(input.title ? { title: input.title } : {}),
      ...(input.mimeType ? { mimeType: input.mimeType } : {}),
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      ...(input.turnId ? { turnId: input.turnId } : {}),
      ...(input.sourceTool ? { sourceTool: input.sourceTool } : {}),
      ...(input.metadata ? { metadata: input.metadata } : {}),
    };

    this.repository.writeContent(path, input.content);
    this.upsertArtifact(artifact, { setCurrent: input.setCurrent ?? true });
    return artifact;
  }

  list(options: ArtifactListOptions = {}): RuntimeArtifact[] {
    return this.repository.readCatalog().artifacts
      .filter((artifact) => !options.sessionId || artifact.sessionId === options.sessionId)
      .filter((artifact) => !options.domain || artifact.domain === options.domain)
      .filter((artifact) => !options.kind || artifact.kind === options.kind)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id));
  }

  get(id: string): RuntimeArtifact | undefined {
    return this.repository.readCatalog().artifacts.find((artifact) => artifact.id === id);
  }

  read(id: string): ArtifactReadResult | undefined {
    const artifact = this.get(id);
    if (!artifact) {
      return undefined;
    }

    const content = this.repository.readContent(artifact.path);
    return content === undefined ? undefined : { artifact, content };
  }

  current(sessionId?: string): RuntimeArtifact | undefined {
    const store = this.repository.readCatalog();
    const artifactId = sessionId
      ? store.current.sessionArtifactIds[sessionId] ?? store.current.workspaceArtifactId
      : store.current.workspaceArtifactId;

    return artifactId ? store.artifacts.find((artifact) => artifact.id === artifactId) : undefined;
  }

  setCurrent(artifactId: string, options: { sessionId?: string } = {}): RuntimeArtifact {
    const store = this.repository.readCatalog();
    const artifact = store.artifacts.find((candidate) => candidate.id === artifactId);
    if (!artifact) {
      throw new Error(`Artifact not found: ${artifactId}`);
    }

    if (options.sessionId) {
      store.current.sessionArtifactIds[options.sessionId] = artifactId;
    } else {
      store.current.workspaceArtifactId = artifactId;
    }
    this.repository.writeCatalog(store);
    return artifact;
  }

  private upsertArtifact(artifact: RuntimeArtifact, options: { setCurrent: boolean }): void {
    const store = this.repository.readCatalog();
    const artifacts = [
      artifact,
      ...store.artifacts.filter((candidate) => candidate.id !== artifact.id),
    ];
    const nextStore: ArtifactStore = {
      ...store,
      artifacts,
      current: {
        workspaceArtifactId: options.setCurrent && !artifact.sessionId ? artifact.id : store.current.workspaceArtifactId,
        sessionArtifactIds: {
          ...store.current.sessionArtifactIds,
          ...(options.setCurrent && artifact.sessionId ? { [artifact.sessionId]: artifact.id } : {}),
        },
      },
    };
    this.repository.writeCatalog(nextStore);
  }

  private resolveExtension(input: SaveTextArtifactInput): string {
    const extension = input.extension ?? ArtifactService.extensionFromPath(input.title) ?? KIND_EXTENSION[input.kind];
    return extension.replace(/^\./, '').replaceAll(/[^A-Za-z0-9_-]/g, '').toLowerCase() || KIND_EXTENSION[input.kind];
  }

  private assertArtifactId(id: string): string {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) {
      throw new Error(`Invalid artifact id "${id}". Use only letters, numbers, dots, underscores, and hyphens.`);
    }
    return id;
  }

  private static resolveRepository(options: ArtifactServiceOptions): ArtifactRepository {
    if (options.repository) {
      return options.repository;
    }

    if (!options.artifactRoot) {
      throw new Error('ArtifactService requires either a repository or an artifactRoot.');
    }

    return new FileArtifactRepository({ artifactRoot: options.artifactRoot });
  }

  private static extensionFromPath(path: string | undefined): string | undefined {
    if (!path) {
      return undefined;
    }
    const extension = extname(basename(path));
    return extension ? extension.slice(1) : undefined;
  }

  static relativeArtifactPath(artifactRoot: string, artifact: Pick<RuntimeArtifact, 'path'>): string {
    return relative(resolve(artifactRoot), artifact.path);
  }
}
