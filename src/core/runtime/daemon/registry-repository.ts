/**
 * File-backed daemon registry repository.
 *
 * Owns registry path resolution and JSON I/O. Registry semantics live in
 * `RuntimeDaemonRegistryService`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DaemonRegistrySchema } from './schemas.js';
import type { DaemonRegistry } from './types.js';

export class FileDaemonRegistryRepository {
  private readonly registryPath: string;

  constructor(args: { registryPath: string }) {
    this.registryPath = args.registryPath;
  }

  static resolvePath(baseDir = join(homedir(), '.heddle')): string {
    return join(resolve(baseDir), 'daemon-registry.json');
  }

  exists(): boolean {
    return existsSync(this.registryPath);
  }

  readRaw(): unknown | undefined {
    if (!this.exists()) {
      return undefined;
    }

    return JSON.parse(readFileSync(this.registryPath, 'utf8')) as unknown;
  }

  save(registry: DaemonRegistry): void {
    mkdirSync(dirname(this.registryPath), { recursive: true });
    writeFileSync(this.registryPath, `${JSON.stringify(DaemonRegistrySchema.parse(registry), null, 2)}\n`, 'utf8');
  }
}
