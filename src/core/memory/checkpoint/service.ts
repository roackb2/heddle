import { randomUUID } from 'node:crypto';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  rmdir,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import type { MemoryScopeId } from '../scope.js';
import { MemoryCheckpointCodec } from './codec.js';
import {
  MemoryCheckpointCaptureError,
  MemoryCheckpointCorruptionError,
  MemoryCheckpointRestoreTargetError,
} from './errors.js';
import {
  MemoryCheckpointGenerationIdSchema,
  type MemoryCheckpointFile,
  type MemoryCheckpointManifest,
} from './schemas.js';
import type {
  MemoryCheckpointBundle,
  MemoryCheckpointServiceOptions,
  MemoryCheckpointStore,
  RestoreMemoryCheckpointResult,
} from './types.js';

/**
 * Owns explicit checkpoint, restore-before-use, and deletion operations for
 * one local Heddle memory working copy over a host-supplied durable store.
 */
export class MemoryCheckpointService {
  private readonly now: () => Date;
  private readonly createGenerationId: NonNullable<MemoryCheckpointServiceOptions['createGenerationId']>;

  constructor(
    private readonly memoryRoot: string,
    private readonly store: MemoryCheckpointStore,
    options: MemoryCheckpointServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.createGenerationId = options.createGenerationId
      ?? (() => MemoryCheckpointGenerationIdSchema.parse(`memory-generation-v1-${randomUUID()}`));
  }

  /**
   * Captures the current working copy and commits it as one immutable
   * generation. Callers invoke this only after a memory-changing interaction
   * or maintenance transaction reaches its stable boundary.
   */
  async checkpoint(scopeId: MemoryScopeId): Promise<MemoryCheckpointManifest> {
    const prior = await this.loadManifest(scopeId);
    const timestamp = this.now().toISOString();
    const generation = MemoryCheckpointCodec.createGeneration({
      scopeId,
      generationId: this.createGenerationId(),
      createdAt: timestamp,
      files: await this.captureFiles(),
    });
    const manifest = MemoryCheckpointCodec.createManifest({
      generation,
      committedAt: timestamp,
    });

    await this.store.commit({
      expectedGenerationId: prior?.generationId ?? null,
      generation,
      manifest,
    });
    return manifest;
  }

  /** Loads and validates the complete generation named by the committed manifest. */
  async load(scopeId: MemoryScopeId): Promise<MemoryCheckpointBundle | undefined> {
    const persistedManifest = await this.store.loadManifest(scopeId);
    if (persistedManifest === undefined) {
      return undefined;
    }

    const manifest = MemoryCheckpointCodec.parseManifest(persistedManifest, scopeId);
    const persistedGeneration = await this.store.loadGeneration({
      scopeId,
      generationId: manifest.generationId,
    });
    if (persistedGeneration === undefined) {
      throw new MemoryCheckpointCorruptionError(
        scopeId,
        `committed generation is missing: ${manifest.generationId}`,
      );
    }

    const generation = MemoryCheckpointCodec.parseGeneration(
      persistedGeneration,
      scopeId,
      manifest.generationId,
    );
    MemoryCheckpointCodec.validateCommitted(manifest, generation);
    return { manifest, generation };
  }

  /**
   * Restores a committed checkpoint before the memory workspace is
   * bootstrapped or accessed. Existing memory is never merged or overwritten.
   */
  async restore(scopeId: MemoryScopeId): Promise<RestoreMemoryCheckpointResult> {
    const checkpoint = await this.load(scopeId);
    if (!checkpoint) {
      return { status: 'absent' };
    }

    const memoryRoot = resolve(this.memoryRoot);
    await this.prepareRestoreTarget(memoryRoot);
    await this.restoreGeneration(memoryRoot, checkpoint);
    return {
      status: 'restored',
      memoryRoot,
      manifest: checkpoint.manifest,
    };
  }

  /** Removes the authoritative checkpoint without inventing file-merge semantics. */
  async delete(scopeId: MemoryScopeId): Promise<boolean> {
    const manifest = await this.loadManifest(scopeId);
    if (!manifest) {
      return false;
    }

    await this.store.delete({
      scopeId,
      expectedGenerationId: manifest.generationId,
    });
    return true;
  }

  private async loadManifest(scopeId: MemoryScopeId): Promise<MemoryCheckpointManifest | undefined> {
    const persistedManifest = await this.store.loadManifest(scopeId);
    return persistedManifest === undefined
      ? undefined
      : MemoryCheckpointCodec.parseManifest(persistedManifest, scopeId);
  }

  private async captureFiles(): Promise<MemoryCheckpointFile[]> {
    const configuredRoot = resolve(this.memoryRoot);
    let memoryRoot: string;
    try {
      memoryRoot = await realpath(configuredRoot);
    } catch (error) {
      throw new MemoryCheckpointCaptureError(configuredRoot, 'memory root does not exist', { cause: error });
    }

    const files: MemoryCheckpointFile[] = [];
    await this.walkMemoryFiles(memoryRoot, memoryRoot, files);
    return files;
  }

  private async walkMemoryFiles(
    memoryRoot: string,
    directory: string,
    files: MemoryCheckpointFile[],
  ): Promise<void> {
    const entries = (await readdir(directory, { withFileTypes: true }))
      .sort((left, right) => Buffer.compare(Buffer.from(left.name), Buffer.from(right.name)));

    for (const entry of entries) {
      const path = join(directory, entry.name);
      const portablePath = relative(memoryRoot, path).split(sep).join('/');

      if (entry.isSymbolicLink()) {
        throw new MemoryCheckpointCaptureError(
          memoryRoot,
          `symbolic links are not portable memory state: ${portablePath}`,
        );
      }
      if (entry.isDirectory()) {
        await this.walkMemoryFiles(memoryRoot, path, files);
        continue;
      }
      if (!MemoryCheckpointCodec.isPortablePath(portablePath)) {
        continue;
      }
      if (!entry.isFile()) {
        throw new MemoryCheckpointCaptureError(
          memoryRoot,
          `portable memory path is not a regular file: ${portablePath}`,
        );
      }

      files.push(MemoryCheckpointCodec.createFile(portablePath, await readFile(path)));
    }
  }

  private async prepareRestoreTarget(memoryRoot: string): Promise<void> {
    try {
      const target = await lstat(memoryRoot);
      if (!target.isDirectory() || target.isSymbolicLink()) {
        throw new MemoryCheckpointRestoreTargetError(memoryRoot);
      }
      if ((await readdir(memoryRoot)).length > 0) {
        throw new MemoryCheckpointRestoreTargetError(memoryRoot);
      }
      await rmdir(memoryRoot);
    } catch (error) {
      if (MemoryCheckpointService.isErrorWithCode(error, 'ENOENT')) {
        return;
      }
      throw error;
    }
  }

  private async restoreGeneration(memoryRoot: string, checkpoint: MemoryCheckpointBundle): Promise<void> {
    const parent = dirname(memoryRoot);
    await mkdir(parent, { recursive: true });
    const stagingRoot = await mkdtemp(join(parent, `.${basename(memoryRoot)}.restore-`));

    try {
      for (const file of checkpoint.generation.files) {
        const targetPath = resolve(stagingRoot, ...file.path.split('/'));
        await mkdir(dirname(targetPath), { recursive: true });
        await writeFile(
          targetPath,
          MemoryCheckpointCodec.decodeFile(checkpoint.manifest.scopeId, file),
          { flag: 'wx', mode: 0o600 },
        );
      }
      await rename(stagingRoot, memoryRoot);
    } finally {
      await rm(stagingRoot, { recursive: true, force: true });
    }
  }

  private static isErrorWithCode(error: unknown, code: string): error is Error & { code: string } {
    return error instanceof Error && 'code' in error && error.code === code;
  }
}
