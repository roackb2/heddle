import { randomUUID } from 'node:crypto';
import { isAbsolute, parse, resolve } from 'node:path';
import {
  PortableDirectoryCheckpointCaptureError,
  PortableDirectoryCheckpointCorruptionError,
  PortableDirectoryCheckpointPolicy,
  PortableDirectoryCheckpointRestoreTargetError,
  PortableDirectoryCheckpointService,
} from '../../checkpoint/portable-directory/index.js';
import { WorkingSetScopeIdSchema, type WorkingSetScopeId } from '../scope.js';
import { WorkingSetCheckpointCodec } from './codec.js';
import {
  WorkingSetCheckpointCaptureError,
  WorkingSetCheckpointConfigurationError,
  WorkingSetCheckpointCorruptionError,
  WorkingSetCheckpointRecoveryError,
} from './errors.js';
import {
  WorkingSetCheckpointGenerationIdSchema,
  type WorkingSetCheckpointFile,
  type WorkingSetCheckpointManifest,
} from './schemas.js';
import type {
  PrepareOrRecoverWorkingSetResult,
  WorkingSetCheckpointBundle,
  WorkingSetCheckpointServiceOptions,
  WorkingSetCheckpointStore,
} from './types.js';

/**
 * Owns bounded checkpoint and crash-idempotent recovery for one dedicated,
 * disposable local working directory over a host-supplied durable store.
 */
export class WorkingSetCheckpointService {
  private readonly workingRoot: string;
  private readonly now: () => Date;
  private readonly createGenerationId: NonNullable<WorkingSetCheckpointServiceOptions['createGenerationId']>;
  private readonly resetLocalWorkingCopy: WorkingSetCheckpointServiceOptions['resetLocalWorkingCopy'];
  private readonly directory: PortableDirectoryCheckpointService;

  constructor(
    workingRoot: string,
    private readonly store: WorkingSetCheckpointStore,
    options: WorkingSetCheckpointServiceOptions,
  ) {
    this.workingRoot = WorkingSetCheckpointService.resolveDisposableRoot(workingRoot);
    if (!options?.limits) {
      throw new WorkingSetCheckpointConfigurationError('explicit resource limits are required');
    }
    if (typeof options.resetLocalWorkingCopy !== 'function') {
      throw new WorkingSetCheckpointConfigurationError('resetLocalWorkingCopy must be a function');
    }

    this.now = options.now ?? (() => new Date());
    this.createGenerationId = options.createGenerationId
      ?? (() => WorkingSetCheckpointGenerationIdSchema.parse(`working-set-generation-v1-${randomUUID()}`));
    this.resetLocalWorkingCopy = options.resetLocalWorkingCopy;
    this.directory = new PortableDirectoryCheckpointService(
      this.workingRoot,
      new PortableDirectoryCheckpointPolicy({
        limits: options.limits,
        includeFile: () => true,
      }),
    );
  }

  /** Captures and commits the complete stable local working set. */
  async checkpoint(scopeId: WorkingSetScopeId): Promise<WorkingSetCheckpointManifest> {
    const validatedScopeId = WorkingSetScopeIdSchema.parse(scopeId);
    const prior = await this.loadManifest(validatedScopeId);
    const timestamp = this.now().toISOString();
    const generation = WorkingSetCheckpointCodec.createGeneration({
      scopeId: validatedScopeId,
      generationId: this.createGenerationId(),
      createdAt: timestamp,
      files: await this.captureFiles(),
    });
    const manifest = WorkingSetCheckpointCodec.createManifest({
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

  /** Loads and fully validates the generation named by the committed manifest. */
  async load(scopeId: WorkingSetScopeId): Promise<WorkingSetCheckpointBundle | undefined> {
    const validatedScopeId = WorkingSetScopeIdSchema.parse(scopeId);
    const persistedManifest = await this.store.loadManifest(validatedScopeId);
    if (persistedManifest === undefined) {
      return undefined;
    }

    const manifest = WorkingSetCheckpointCodec.parseManifest(persistedManifest, validatedScopeId);
    const persistedGeneration = await this.store.loadGeneration({
      scopeId: validatedScopeId,
      generationId: manifest.generationId,
    });
    if (persistedGeneration === undefined) {
      throw new WorkingSetCheckpointCorruptionError(
        validatedScopeId,
        `committed generation is missing: ${manifest.generationId}`,
      );
    }

    const generation = WorkingSetCheckpointCodec.parseGeneration(
      persistedGeneration,
      validatedScopeId,
      manifest.generationId,
    );
    this.validateFiles(validatedScopeId, generation.files);
    WorkingSetCheckpointCodec.validateCommitted(manifest, generation);
    return { manifest, generation };
  }

  /**
   * Prepares the local directory before tools are exposed. Durable state is
   * fully validated first; the host then resets its disposable local copy and
   * this service verifies and restores the committed contents, or an empty set.
   */
  async prepareOrRecover(scopeId: WorkingSetScopeId): Promise<PrepareOrRecoverWorkingSetResult> {
    const validatedScopeId = WorkingSetScopeIdSchema.parse(scopeId);
    const checkpoint = await this.load(validatedScopeId);

    await this.resetLocalCopy();
    await this.restoreFiles(validatedScopeId, checkpoint?.generation.files ?? []);

    return checkpoint
      ? {
        status: 'restored-committed',
        workingRoot: this.workingRoot,
        manifest: checkpoint.manifest,
      }
      : {
        status: 'initialized-empty',
        workingRoot: this.workingRoot,
      };
  }

  private async captureFiles(): Promise<WorkingSetCheckpointFile[]> {
    try {
      return await this.directory.capture();
    } catch (error) {
      if (error instanceof PortableDirectoryCheckpointCaptureError) {
        throw new WorkingSetCheckpointCaptureError(error.directoryRoot, error.detail, { cause: error });
      }
      throw error;
    }
  }

  private async loadManifest(
    scopeId: WorkingSetScopeId,
  ): Promise<WorkingSetCheckpointManifest | undefined> {
    const persistedManifest = await this.store.loadManifest(scopeId);
    return persistedManifest === undefined
      ? undefined
      : WorkingSetCheckpointCodec.parseManifest(persistedManifest, scopeId);
  }

  private validateFiles(
    scopeId: WorkingSetScopeId,
    files: readonly WorkingSetCheckpointFile[],
  ): void {
    try {
      this.directory.validate(files);
    } catch (error) {
      if (error instanceof PortableDirectoryCheckpointCorruptionError) {
        throw new WorkingSetCheckpointCorruptionError(scopeId, error.detail, { cause: error });
      }
      throw error;
    }
  }

  private async resetLocalCopy(): Promise<void> {
    try {
      await this.resetLocalWorkingCopy();
    } catch (error) {
      throw new WorkingSetCheckpointRecoveryError(
        this.workingRoot,
        'host could not reset the disposable local working copy',
        { cause: error },
      );
    }
  }

  private async restoreFiles(
    scopeId: WorkingSetScopeId,
    files: readonly WorkingSetCheckpointFile[],
  ): Promise<void> {
    try {
      await this.directory.restore(files);
    } catch (error) {
      if (error instanceof PortableDirectoryCheckpointCorruptionError) {
        throw new WorkingSetCheckpointCorruptionError(scopeId, error.detail, { cause: error });
      }
      if (error instanceof PortableDirectoryCheckpointRestoreTargetError) {
        throw new WorkingSetCheckpointRecoveryError(
          this.workingRoot,
          'host reset did not leave an absent or empty working root',
          { cause: error },
        );
      }
      throw new WorkingSetCheckpointRecoveryError(
        this.workingRoot,
        error instanceof Error ? error.message : String(error),
        { cause: error },
      );
    }
  }

  private static resolveDisposableRoot(workingRoot: string): string {
    if (!workingRoot || workingRoot !== workingRoot.trim()) {
      throw new WorkingSetCheckpointConfigurationError(
        'workingRoot must be a non-empty path without outer whitespace',
      );
    }
    if (!isAbsolute(workingRoot)) {
      throw new WorkingSetCheckpointConfigurationError('workingRoot must be absolute');
    }

    const resolvedRoot = resolve(workingRoot);
    if (resolvedRoot === parse(resolvedRoot).root) {
      throw new WorkingSetCheckpointConfigurationError('workingRoot must not be a filesystem root');
    }
    return resolvedRoot;
  }
}
