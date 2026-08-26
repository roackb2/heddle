import { z } from 'zod';
import { MemoryScopeIdSchema } from '../scope.js';

export const MEMORY_CHECKPOINT_SCHEMA_VERSION = 1 as const;

export const MemoryCheckpointGenerationIdSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u)
  .brand('MemoryCheckpointGenerationId');

export const MemoryCheckpointFileSchema = z.object({
  path: z.string().min(1),
  contentBase64: z.string(),
  byteLength: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();

export const MemoryCheckpointGenerationSchema = z.object({
  kind: z.literal('heddle-memory-checkpoint-generation'),
  schemaVersion: z.literal(MEMORY_CHECKPOINT_SCHEMA_VERSION),
  scopeId: MemoryScopeIdSchema,
  generationId: MemoryCheckpointGenerationIdSchema,
  createdAt: z.iso.datetime(),
  files: z.array(MemoryCheckpointFileSchema),
}).strict();

export const MemoryCheckpointManifestSchema = z.object({
  kind: z.literal('heddle-memory-checkpoint-manifest'),
  schemaVersion: z.literal(MEMORY_CHECKPOINT_SCHEMA_VERSION),
  scopeId: MemoryScopeIdSchema,
  generationId: MemoryCheckpointGenerationIdSchema,
  generationSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  fileCount: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
  committedAt: z.iso.datetime(),
}).strict();

export type MemoryCheckpointGenerationId = z.infer<typeof MemoryCheckpointGenerationIdSchema>;
export type MemoryCheckpointFile = z.infer<typeof MemoryCheckpointFileSchema>;
export type MemoryCheckpointGeneration = z.infer<typeof MemoryCheckpointGenerationSchema>;
export type MemoryCheckpointManifest = z.infer<typeof MemoryCheckpointManifestSchema>;
