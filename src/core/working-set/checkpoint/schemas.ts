import { z } from 'zod';
import { PortableDirectoryCheckpointFileSchema } from '../../checkpoint/portable-directory/index.js';
import { WorkingSetScopeIdSchema } from '../scope.js';

export const WORKING_SET_CHECKPOINT_SCHEMA_VERSION = 1 as const;

export const WorkingSetCheckpointGenerationIdSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u)
  .brand('WorkingSetCheckpointGenerationId');

export const WorkingSetCheckpointFileSchema = PortableDirectoryCheckpointFileSchema;

export const WorkingSetCheckpointGenerationSchema = z.object({
  kind: z.literal('heddle-working-set-checkpoint-generation'),
  schemaVersion: z.literal(WORKING_SET_CHECKPOINT_SCHEMA_VERSION),
  scopeId: WorkingSetScopeIdSchema,
  generationId: WorkingSetCheckpointGenerationIdSchema,
  createdAt: z.iso.datetime(),
  files: z.array(WorkingSetCheckpointFileSchema),
}).strict();

export const WorkingSetCheckpointManifestSchema = z.object({
  kind: z.literal('heddle-working-set-checkpoint-manifest'),
  schemaVersion: z.literal(WORKING_SET_CHECKPOINT_SCHEMA_VERSION),
  scopeId: WorkingSetScopeIdSchema,
  generationId: WorkingSetCheckpointGenerationIdSchema,
  generationSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  fileCount: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
  committedAt: z.iso.datetime(),
}).strict();

export type WorkingSetCheckpointGenerationId = z.infer<typeof WorkingSetCheckpointGenerationIdSchema>;
export type WorkingSetCheckpointFile = z.infer<typeof WorkingSetCheckpointFileSchema>;
export type WorkingSetCheckpointGeneration = z.infer<typeof WorkingSetCheckpointGenerationSchema>;
export type WorkingSetCheckpointManifest = z.infer<typeof WorkingSetCheckpointManifestSchema>;
