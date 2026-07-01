import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ArtifactStoreSchema } from './schemas.js';
import type { ArtifactStore, FileArtifactRepositoryOptions } from './types.js';

/**
 * File-backed artifact repository for the artifact index.
 */
export class FileArtifactRepository {
  private readonly storePath: string;

  constructor(options: FileArtifactRepositoryOptions) {
    this.storePath = FileArtifactRepository.resolveStorePath(options.artifactRoot);
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

  read(): ArtifactStore {
    if (!existsSync(this.storePath)) {
      return FileArtifactRepository.emptyStore();
    }

    try {
      return ArtifactStoreSchema.parse(JSON.parse(readFileSync(this.storePath, 'utf8')) as unknown) as ArtifactStore;
    } catch {
      return FileArtifactRepository.emptyStore();
    }
  }

  write(store: ArtifactStore): void {
    mkdirSync(dirname(this.storePath), { recursive: true });
    writeFileSync(this.storePath, `${JSON.stringify(ArtifactStoreSchema.parse(store), null, 2)}\n`, 'utf8');
  }
}
