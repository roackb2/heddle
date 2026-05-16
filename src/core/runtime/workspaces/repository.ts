/**
 * File-backed runtime workspace repository.
 *
 * Owns catalog paths and JSON file I/O. Workspace semantics live in
 * `RuntimeWorkspaceService`; callers should not read or write workspace catalog
 * files directly.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { WorkspaceCatalogSchema } from './schemas.js';
import type { WorkspaceCatalog } from './types.js';

export class FileWorkspaceRepository {
  private readonly catalogPath: string;

  constructor(args: { catalogPath: string }) {
    this.catalogPath = args.catalogPath;
  }

  static resolveCatalogPath(stateRoot: string): string {
    return join(stateRoot, 'workspaces.catalog.json');
  }

  exists(): boolean {
    return existsSync(this.catalogPath);
  }

  readRaw(): unknown {
    return JSON.parse(readFileSync(this.catalogPath, 'utf8')) as unknown;
  }

  save(catalog: WorkspaceCatalog): void {
    mkdirSync(dirname(this.catalogPath), { recursive: true });
    writeFileSync(this.catalogPath, `${JSON.stringify(WorkspaceCatalogSchema.parse(catalog), null, 2)}\n`, 'utf8');
  }

  path(): string {
    return this.catalogPath;
  }

  static forStateRoot(stateRoot: string): FileWorkspaceRepository {
    return new FileWorkspaceRepository({
      catalogPath: FileWorkspaceRepository.resolveCatalogPath(resolve(stateRoot)),
    });
  }
}
