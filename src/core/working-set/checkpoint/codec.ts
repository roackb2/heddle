import { createHash } from 'node:crypto';
import {
  PortableDirectoryCheckpointCodec,
  PortableDirectoryCheckpointCorruptionError,
} from '../../checkpoint/portable-directory/index.js';
import type { WorkingSetScopeId } from '../scope.js';
import { WorkingSetCheckpointCorruptionError } from './errors.js';
import {
  WorkingSetCheckpointGenerationSchema,
  WorkingSetCheckpointManifestSchema,
  type WorkingSetCheckpointFile,
  type WorkingSetCheckpointGeneration,
  type WorkingSetCheckpointGenerationId,
  type WorkingSetCheckpointManifest,
} from './schemas.js';

type CreateWorkingSetCheckpointGenerationInput = {
  scopeId: WorkingSetScopeId;
  generationId: WorkingSetCheckpointGenerationId;
  createdAt: string;
  files: WorkingSetCheckpointFile[];
};

type CreateWorkingSetCheckpointManifestInput = {
  generation: WorkingSetCheckpointGeneration;
  committedAt: string;
};

/**
 * Owns the provider-neutral v1 wire shape and integrity rules for immutable
 * generations and the manifest that selects the current recovery point.
 */
export class WorkingSetCheckpointCodec {
  static createGeneration(
    input: CreateWorkingSetCheckpointGenerationInput,
  ): WorkingSetCheckpointGeneration {
    const generation = WorkingSetCheckpointGenerationSchema.parse({
      kind: 'heddle-working-set-checkpoint-generation',
      schemaVersion: 1,
      ...input,
      files: [...input.files].sort((left, right) => PortableDirectoryCheckpointCodec.comparePaths(
        left.path,
        right.path,
      )),
    });

    WorkingSetCheckpointCodec.validateFiles(generation.scopeId, generation.files);
    return generation;
  }

  static createManifest(
    input: CreateWorkingSetCheckpointManifestInput,
  ): WorkingSetCheckpointManifest {
    return WorkingSetCheckpointManifestSchema.parse({
      kind: 'heddle-working-set-checkpoint-manifest',
      schemaVersion: 1,
      scopeId: input.generation.scopeId,
      generationId: input.generation.generationId,
      generationSha256: WorkingSetCheckpointCodec.generationSha256(input.generation),
      fileCount: input.generation.files.length,
      totalBytes: input.generation.files.reduce((total, file) => total + file.byteLength, 0),
      committedAt: input.committedAt,
    });
  }

  static parseManifest(
    value: unknown,
    expectedScopeId: WorkingSetScopeId,
  ): WorkingSetCheckpointManifest {
    const manifest = WorkingSetCheckpointCodec.parsePersisted(
      expectedScopeId,
      'manifest',
      () => WorkingSetCheckpointManifestSchema.parse(value),
    );
    if (manifest.scopeId !== expectedScopeId) {
      throw new WorkingSetCheckpointCorruptionError(
        expectedScopeId,
        `manifest scope mismatch: found ${manifest.scopeId}`,
      );
    }
    return manifest;
  }

  static parseGeneration(
    value: unknown,
    expectedScopeId: WorkingSetScopeId,
    expectedGenerationId: WorkingSetCheckpointGenerationId,
  ): WorkingSetCheckpointGeneration {
    const generation = WorkingSetCheckpointCodec.parsePersisted(
      expectedScopeId,
      'generation',
      () => WorkingSetCheckpointGenerationSchema.parse(value),
    );
    if (generation.scopeId !== expectedScopeId) {
      throw new WorkingSetCheckpointCorruptionError(
        expectedScopeId,
        `generation scope mismatch: found ${generation.scopeId}`,
      );
    }
    if (generation.generationId !== expectedGenerationId) {
      throw new WorkingSetCheckpointCorruptionError(
        expectedScopeId,
        `generation id mismatch: expected ${expectedGenerationId}, found ${generation.generationId}`,
      );
    }

    WorkingSetCheckpointCodec.validateFiles(expectedScopeId, generation.files);
    return generation;
  }

  static validateCommitted(
    manifest: WorkingSetCheckpointManifest,
    generation: WorkingSetCheckpointGeneration,
  ): void {
    const failures = [
      manifest.scopeId !== generation.scopeId ? 'manifest and generation scopes differ' : undefined,
      manifest.generationId !== generation.generationId ? 'manifest and generation ids differ' : undefined,
      manifest.fileCount !== generation.files.length ? 'manifest file count does not match generation' : undefined,
      manifest.totalBytes !== generation.files.reduce((total, file) => total + file.byteLength, 0)
        ? 'manifest byte count does not match generation'
        : undefined,
      manifest.generationSha256 !== WorkingSetCheckpointCodec.generationSha256(generation)
        ? 'manifest checksum does not match generation'
        : undefined,
    ].filter((failure): failure is string => Boolean(failure));

    if (failures[0]) {
      throw new WorkingSetCheckpointCorruptionError(manifest.scopeId, failures[0]);
    }
  }

  static serializeGeneration(generation: WorkingSetCheckpointGeneration): string {
    const parsed = WorkingSetCheckpointGenerationSchema.parse(generation);
    WorkingSetCheckpointCodec.validateFiles(parsed.scopeId, parsed.files);
    return `${JSON.stringify(parsed, null, 2)}\n`;
  }

  static serializeManifest(manifest: WorkingSetCheckpointManifest): string {
    return `${JSON.stringify(WorkingSetCheckpointManifestSchema.parse(manifest), null, 2)}\n`;
  }

  private static validateFiles(
    scopeId: WorkingSetScopeId,
    files: readonly WorkingSetCheckpointFile[],
  ): void {
    const paths = new Set<string>();
    let priorPath: string | undefined;

    for (const file of files) {
      try {
        PortableDirectoryCheckpointCodec.decodeFile(file);
      } catch (error) {
        if (error instanceof PortableDirectoryCheckpointCorruptionError) {
          throw new WorkingSetCheckpointCorruptionError(scopeId, error.detail, { cause: error });
        }
        throw error;
      }

      if (paths.has(file.path)) {
        throw new WorkingSetCheckpointCorruptionError(scopeId, `duplicate file path: ${file.path}`);
      }
      if (priorPath && PortableDirectoryCheckpointCodec.comparePaths(priorPath, file.path) >= 0) {
        throw new WorkingSetCheckpointCorruptionError(
          scopeId,
          'generation files are not in canonical path order',
        );
      }

      paths.add(file.path);
      priorPath = file.path;
    }
  }

  private static generationSha256(generation: WorkingSetCheckpointGeneration): string {
    return createHash('sha256')
      .update(WorkingSetCheckpointCodec.serializeGeneration(generation))
      .digest('hex');
  }

  private static parsePersisted<Value>(
    scopeId: WorkingSetScopeId,
    kind: string,
    parse: () => Value,
  ): Value {
    try {
      return parse();
    } catch (error) {
      if (error instanceof WorkingSetCheckpointCorruptionError) {
        throw error;
      }
      throw new WorkingSetCheckpointCorruptionError(
        scopeId,
        `${kind} does not match the supported schema`,
        { cause: error },
      );
    }
  }
}
