import { z } from 'zod';

export const ArtifactKindSchema = z.enum(['source', 'html', 'json', 'image', 'document', 'binary', 'domain']);

export const RuntimeArtifactSchema = z.object({
  id: z.string().min(1),
  kind: ArtifactKindSchema,
  domain: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  path: z.string().min(1),
  mimeType: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  turnId: z.string().min(1).optional(),
  sourceTool: z.string().min(1).optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const ArtifactCurrentPointersSchema = z.object({
  workspaceArtifactId: z.string().min(1).optional(),
  sessionArtifactIds: z.record(z.string(), z.string().min(1)).default({}),
});

export const ArtifactStoreSchema = z.object({
  version: z.literal(1),
  artifacts: z.array(RuntimeArtifactSchema).default([]),
  current: ArtifactCurrentPointersSchema.default({ sessionArtifactIds: {} }),
});
