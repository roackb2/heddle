import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { ArtifactStoreSchema } from './schemas.js';
import type { ArtifactRepository, ArtifactStore, FileArtifactRepositoryOptions } from './types.js';

/**
 * Default file-backed artifact persistence: the catalog index at
 * `artifactRoot/artifacts.json` and content blobs under `artifactRoot/files/`.
 * Implements the `ArtifactRepository` port so hosts can swap in their own
 * storage without touching artifact policy.
 */
export class FileArtifactRepository implements ArtifactRepository {
  private readonly storePath: string;
  private readonly filesRoot: string;

  constructor(options: FileArtifactRepositoryOptions) {
    const artifactRoot = resolve(options.artifactRoot);
    this.storePath = FileArtifactRepository.resolveStorePath(artifactRoot);
    this.filesRoot = join(artifactRoot, 'files');
  }

  static resolveStorePath(artifactRoot: string): string {
    return resolve(artifactRoot, 'artifacts.json');
  }

  static emptyStore(): ArtifactStore {
    return {
      version: 1,
      artifacts: [],
      current: {
        sessionArtifactIds: {},
      },
    };
  }

  readCatalog(): ArtifactStore {
    if (!existsSync(this.storePath)) {
      return FileArtifactRepository.emptyStore();
    }

    try {
      return ArtifactStoreSchema.parse(JSON.parse(readFileSync(this.storePath, 'utf8')) as unknown) as ArtifactStore;
    } catch {
      return FileArtifactRepository.emptyStore();
    }
  }

  writeCatalog(store: ArtifactStore): void {
    mkdirSync(dirname(this.storePath), { recursive: true });
    writeFileSync(this.storePath, `${JSON.stringify(ArtifactStoreSchema.parse(store), null, 2)}\n`, 'utf8');
  }

  contentKey(id: string, extension: string): string {
    return join(this.filesRoot, `${id}.${extension}`);
  }

  contentExists(key: string): boolean {
    return existsSync(key);
  }

  writeContent(key: string, content: string): void {
    mkdirSync(dirname(key), { recursive: true });
    writeFileSync(key, content, 'utf8');
  }

  readContent(key: string): string | undefined {
    if (!existsSync(key)) {
      return undefined;
    }

    return readFileSync(key, 'utf8');
  }
}
