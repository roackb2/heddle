import { createHash } from 'node:crypto';
import {
  PortableDirectoryCheckpointCodec,
  PortableDirectoryCheckpointCorruptionError,
} from '../../checkpoint/portable-directory/index.js';
import type { MemoryScopeId } from '../scope.js';
import { memoryCheckpointDirectoryPolicy } from './directory-policy.js';
import { MemoryCheckpointCorruptionError } from './errors.js';
import {
  MemoryCheckpointFileSchema,
  MemoryCheckpointGenerationSchema,
  MemoryCheckpointManifestSchema,
  type MemoryCheckpointFile,
  type MemoryCheckpointGeneration,
  type MemoryCheckpointGenerationId,
  type MemoryCheckpointManifest,
} from './schemas.js';

type CreateMemoryCheckpointGenerationInput = {
  scopeId: MemoryScopeId;
  generationId: MemoryCheckpointGenerationId;
  createdAt: string;
  files: MemoryCheckpointFile[];
};

type CreateMemoryCheckpointManifestInput = {
  generation: MemoryCheckpointGeneration;
  committedAt: string;
};

/**
 * Owns the provider-neutral, versioned encoding and integrity rules for one
 * allowlisted Heddle memory generation.
 */
export class MemoryCheckpointCodec {
  static isPortablePath(path: string): boolean {
    return memoryCheckpointDirectoryPolicy.includes(path);
  }

  static createFile(path: string, content: Buffer): MemoryCheckpointFile {
    return MemoryCheckpointFileSchema.parse(PortableDirectoryCheckpointCodec.createFile(path, content));
  }

  static createGeneration(input: CreateMemoryCheckpointGenerationInput): MemoryCheckpointGeneration {
    const generation = MemoryCheckpointGenerationSchema.parse({
      kind: 'heddle-memory-checkpoint-generation',
      schemaVersion: 1,
      ...input,
      files: [...input.files].sort((left, right) => PortableDirectoryCheckpointCodec.comparePaths(
        left.path,
        right.path,
      )),
    });

    MemoryCheckpointCodec.validateFiles(generation.scopeId, generation.files);
    return generation;
  }

  static createManifest(input: CreateMemoryCheckpointManifestInput): MemoryCheckpointManifest {
    return MemoryCheckpointManifestSchema.parse({
      kind: 'heddle-memory-checkpoint-manifest',
      schemaVersion: 1,
      scopeId: input.generation.scopeId,
      generationId: input.generation.generationId,
      generationSha256: MemoryCheckpointCodec.generationSha256(input.generation),
      fileCount: input.generation.files.length,
      totalBytes: input.generation.files.reduce((total, file) => total + file.byteLength, 0),
      committedAt: input.committedAt,
    });
  }

  static parseManifest(value: unknown, expectedScopeId: MemoryScopeId): MemoryCheckpointManifest {
    const manifest = MemoryCheckpointCodec.parsePersisted(
      expectedScopeId,
      'manifest',
      () => MemoryCheckpointManifestSchema.parse(value),
    );
    if (manifest.scopeId !== expectedScopeId) {
      throw new MemoryCheckpointCorruptionError(
        expectedScopeId,
        `manifest scope mismatch: found ${manifest.scopeId}`,
      );
    }
    return manifest;
  }

  static parseGeneration(
    value: unknown,
    expectedScopeId: MemoryScopeId,
    expectedGenerationId: MemoryCheckpointGenerationId,
  ): MemoryCheckpointGeneration {
    const generation = MemoryCheckpointCodec.parsePersisted(
      expectedScopeId,
      'generation',
      () => MemoryCheckpointGenerationSchema.parse(value),
    );
    if (generation.scopeId !== expectedScopeId) {
      throw new MemoryCheckpointCorruptionError(
        expectedScopeId,
        `generation scope mismatch: found ${generation.scopeId}`,
      );
    }
    if (generation.generationId !== expectedGenerationId) {
      throw new MemoryCheckpointCorruptionError(
        expectedScopeId,
        `generation id mismatch: expected ${expectedGenerationId}, found ${generation.generationId}`,
      );
    }

    MemoryCheckpointCodec.validateFiles(expectedScopeId, generation.files);
    return generation;
  }

  static validateCommitted(
    manifest: MemoryCheckpointManifest,
    generation: MemoryCheckpointGeneration,
  ): void {
    const failures = [
      manifest.scopeId !== generation.scopeId ? 'manifest and generation scopes differ' : undefined,
      manifest.generationId !== generation.generationId ? 'manifest and generation ids differ' : undefined,
      manifest.fileCount !== generation.files.length ? 'manifest file count does not match generation' : undefined,
      manifest.totalBytes !== generation.files.reduce((total, file) => total + file.byteLength, 0) ?
        'manifest byte count does not match generation'
      : undefined,
      manifest.generationSha256 !== MemoryCheckpointCodec.generationSha256(generation) ?
        'manifest checksum does not match generation'
      : undefined,
    ].filter((failure): failure is string => Boolean(failure));

    if (failures[0]) {
      throw new MemoryCheckpointCorruptionError(manifest.scopeId, failures[0]);
    }
  }

  static serializeGeneration(generation: MemoryCheckpointGeneration): string {
    const parsed = MemoryCheckpointGenerationSchema.parse(generation);
    MemoryCheckpointCodec.validateFiles(parsed.scopeId, parsed.files);
    return `${JSON.stringify(parsed, null, 2)}\n`;
  }

  static serializeManifest(manifest: MemoryCheckpointManifest): string {
    return `${JSON.stringify(MemoryCheckpointManifestSchema.parse(manifest), null, 2)}\n`;
  }

  static decodeFile(scopeId: MemoryScopeId, file: MemoryCheckpointFile): Buffer {
    if (!MemoryCheckpointCodec.isPortablePath(file.path)) {
      throw new MemoryCheckpointCorruptionError(scopeId, `path is not portable memory state: ${file.path}`);
    }

    try {
      return PortableDirectoryCheckpointCodec.decodeFile(file);
    } catch (error) {
      if (error instanceof PortableDirectoryCheckpointCorruptionError) {
        throw new MemoryCheckpointCorruptionError(scopeId, error.detail, { cause: error });
      }
      throw error;
    }
  }

  private static validateFiles(scopeId: MemoryScopeId, files: MemoryCheckpointFile[]): void {
    const paths = new Set<string>();
    let priorPath: string | undefined;

    for (const file of files) {
      MemoryCheckpointCodec.decodeFile(scopeId, file);
      if (paths.has(file.path)) {
        throw new MemoryCheckpointCorruptionError(scopeId, `duplicate file path: ${file.path}`);
      }
      if (priorPath && PortableDirectoryCheckpointCodec.comparePaths(priorPath, file.path) >= 0) {
        throw new MemoryCheckpointCorruptionError(scopeId, 'generation files are not in canonical path order');
      }
      paths.add(file.path);
      priorPath = file.path;
    }
  }

  private static generationSha256(generation: MemoryCheckpointGeneration): string {
    return MemoryCheckpointCodec.sha256(Buffer.from(MemoryCheckpointCodec.serializeGeneration(generation), 'utf8'));
  }

  private static sha256(content: Buffer): string {
    return createHash('sha256').update(content).digest('hex');
  }

  private static parsePersisted<T>(
    scopeId: MemoryScopeId,
    kind: string,
    parse: () => T,
  ): T {
    try {
      return parse();
    } catch (error) {
      if (error instanceof MemoryCheckpointCorruptionError) {
        throw error;
      }
      throw new MemoryCheckpointCorruptionError(
        scopeId,
        `${kind} does not match the supported schema`,
        { cause: error },
      );
    }
  }
}
