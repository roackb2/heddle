import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import type { MemoryScopeId } from '../scope.js';
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

const PORTABLE_MAINTENANCE_FILES = new Set([
  '_maintenance/candidates.jsonl',
  '_maintenance/runs.jsonl',
]);

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
    if (!MemoryCheckpointCodec.isCanonicalRelativePath(path)) {
      return false;
    }

    if (PORTABLE_MAINTENANCE_FILES.has(path)) {
      return true;
    }

    return !path.startsWith('_maintenance/') && path.endsWith('.md');
  }

  static createFile(path: string, content: Buffer): MemoryCheckpointFile {
    return MemoryCheckpointFileSchema.parse({
      path,
      contentBase64: content.toString('base64'),
      byteLength: content.byteLength,
      sha256: MemoryCheckpointCodec.sha256(content),
    });
  }

  static createGeneration(input: CreateMemoryCheckpointGenerationInput): MemoryCheckpointGeneration {
    const generation = MemoryCheckpointGenerationSchema.parse({
      kind: 'heddle-memory-checkpoint-generation',
      schemaVersion: 1,
      ...input,
      files: [...input.files].sort((left, right) => MemoryCheckpointCodec.comparePaths(left.path, right.path)),
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

    const content = Buffer.from(file.contentBase64, 'base64');
    if (content.toString('base64') !== file.contentBase64) {
      throw new MemoryCheckpointCorruptionError(scopeId, `file has invalid base64 content: ${file.path}`);
    }
    if (content.byteLength !== file.byteLength) {
      throw new MemoryCheckpointCorruptionError(scopeId, `file byte length does not match content: ${file.path}`);
    }
    if (MemoryCheckpointCodec.sha256(content) !== file.sha256) {
      throw new MemoryCheckpointCorruptionError(scopeId, `file checksum does not match content: ${file.path}`);
    }
    return content;
  }

  private static validateFiles(scopeId: MemoryScopeId, files: MemoryCheckpointFile[]): void {
    const paths = new Set<string>();
    let priorPath: string | undefined;

    for (const file of files) {
      MemoryCheckpointCodec.decodeFile(scopeId, file);
      if (paths.has(file.path)) {
        throw new MemoryCheckpointCorruptionError(scopeId, `duplicate file path: ${file.path}`);
      }
      if (priorPath && MemoryCheckpointCodec.comparePaths(priorPath, file.path) >= 0) {
        throw new MemoryCheckpointCorruptionError(scopeId, 'generation files are not in canonical path order');
      }
      paths.add(file.path);
      priorPath = file.path;
    }
  }

  private static isCanonicalRelativePath(path: string): boolean {
    return Boolean(path)
      && !path.includes('\\')
      && !path.includes('\0')
      && !posix.isAbsolute(path)
      && posix.normalize(path) === path
      && path !== '.'
      && !path.startsWith('../');
  }

  private static comparePaths(left: string, right: string): number {
    return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
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
