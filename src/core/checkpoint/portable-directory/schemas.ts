import { z } from 'zod';

/** Shared integrity envelope for one regular file in a portable directory. */
export const PortableDirectoryCheckpointFileSchema = z.object({
  path: z.string().min(1),
  contentBase64: z.string(),
  byteLength: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();

export type PortableDirectoryCheckpointFile = z.infer<typeof PortableDirectoryCheckpointFileSchema>;
