import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join, relative, resolve } from 'node:path';
import dayjs from 'dayjs';
import { FileArtifactRepository } from './repository.js';
import type {
  ArtifactKind,
  ArtifactListOptions,
  ArtifactReadResult,
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
 * Owns artifact persistence and current-artifact selection.
 */
export class ArtifactService {
  private readonly artifactRoot: string;
  private readonly filesRoot: string;
  private readonly repository: FileArtifactRepository;
  private readonly now: () => string;
  private readonly nextId: () => string;

  constructor(options: ArtifactServiceOptions) {
    this.artifactRoot = resolve(options.artifactRoot);
    this.filesRoot = join(this.artifactRoot, 'files');
    this.repository = new FileArtifactRepository({ artifactRoot: this.artifactRoot });
    this.now = options.now ?? (() => dayjs().toISOString());
    this.nextId = options.nextId ?? (() => `artifact-${randomUUID()}`);
  }

  saveText(input: SaveTextArtifactInput): RuntimeArtifact {
    const id = this.assertArtifactId(this.nextId());
    const timestamp = this.now();
    const path = join(this.filesRoot, `${id}.${this.resolveExtension(input)}`);
    if (this.get(id) || existsSync(path)) {
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

    mkdirSync(this.filesRoot, { recursive: true });
    writeFileSync(path, input.content, 'utf8');
    this.upsertArtifact(artifact, { setCurrent: input.setCurrent ?? true });
    return artifact;
  }

  list(options: ArtifactListOptions = {}): RuntimeArtifact[] {
    return this.repository.read().artifacts
      .filter((artifact) => !options.sessionId || artifact.sessionId === options.sessionId)
      .filter((artifact) => !options.domain || artifact.domain === options.domain)
      .filter((artifact) => !options.kind || artifact.kind === options.kind)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id));
  }

  get(id: string): RuntimeArtifact | undefined {
    return this.repository.read().artifacts.find((artifact) => artifact.id === id);
  }

  read(id: string): ArtifactReadResult | undefined {
    const artifact = this.get(id);
    if (!artifact || !existsSync(artifact.path)) {
      return undefined;
    }

    return {
      artifact,
      content: readFileSync(artifact.path, 'utf8'),
    };
  }

  current(sessionId?: string): RuntimeArtifact | undefined {
    const store = this.repository.read();
    const artifactId = sessionId
      ? store.current.sessionArtifactIds[sessionId] ?? store.current.workspaceArtifactId
      : store.current.workspaceArtifactId;

    return artifactId ? store.artifacts.find((artifact) => artifact.id === artifactId) : undefined;
  }

  setCurrent(artifactId: string, options: { sessionId?: string } = {}): RuntimeArtifact {
    const store = this.repository.read();
    const artifact = store.artifacts.find((candidate) => candidate.id === artifactId);
    if (!artifact) {
      throw new Error(`Artifact not found: ${artifactId}`);
    }

    if (options.sessionId) {
      store.current.sessionArtifactIds[options.sessionId] = artifactId;
    } else {
      store.current.workspaceArtifactId = artifactId;
    }
    this.repository.write(store);
    return artifact;
  }

  private upsertArtifact(artifact: RuntimeArtifact, options: { setCurrent: boolean }): void {
    const store = this.repository.read();
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
    this.repository.write(nextStore);
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
