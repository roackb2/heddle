import { randomUUID } from 'node:crypto';
import {
  PortableDirectoryCheckpointCaptureError,
  PortableDirectoryCheckpointCorruptionError,
  PortableDirectoryCheckpointRestoreTargetError,
  PortableDirectoryCheckpointService,
} from '../../checkpoint/portable-directory/index.js';
import type { MemoryScopeId } from '../scope.js';
import { MemoryCheckpointCodec } from './codec.js';
import { memoryCheckpointDirectoryPolicy } from './directory-policy.js';
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
  private readonly directory: PortableDirectoryCheckpointService;

  constructor(
    private readonly memoryRoot: string,
    private readonly store: MemoryCheckpointStore,
    options: MemoryCheckpointServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.createGenerationId = options.createGenerationId
      ?? (() => MemoryCheckpointGenerationIdSchema.parse(`memory-generation-v1-${randomUUID()}`));
    this.directory = new PortableDirectoryCheckpointService(this.memoryRoot, memoryCheckpointDirectoryPolicy);
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

    const memoryRoot = await this.restoreGeneration(checkpoint);
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
    try {
      return await this.directory.capture();
    } catch (error) {
      if (error instanceof PortableDirectoryCheckpointCaptureError) {
        throw new MemoryCheckpointCaptureError(error.directoryRoot, error.detail, { cause: error });
      }
      throw error;
    }
  }

  private async restoreGeneration(checkpoint: MemoryCheckpointBundle): Promise<string> {
    try {
      return await this.directory.restore(checkpoint.generation.files);
    } catch (error) {
      if (error instanceof PortableDirectoryCheckpointRestoreTargetError) {
        throw new MemoryCheckpointRestoreTargetError(error.directoryRoot);
      }
      if (error instanceof PortableDirectoryCheckpointCorruptionError) {
        throw new MemoryCheckpointCorruptionError(
          checkpoint.manifest.scopeId,
          error.detail,
          { cause: error },
        );
      }
      throw error;
    }
  }
}
