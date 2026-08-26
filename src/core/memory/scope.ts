import { createHash } from 'node:crypto';
import { z } from 'zod';

export const MEMORY_SCOPE_VERSION = 1 as const;

const MemoryScopeIdentityPartSchema = z
  .string()
  .min(1)
  .max(256)
  .refine((value) => value === value.trim(), 'must not contain outer whitespace');

const MemoryScopeOwnerSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('agent'),
    id: MemoryScopeIdentityPartSchema,
  }).strict(),
  z.object({
    kind: z.literal('workspace'),
    id: MemoryScopeIdentityPartSchema,
  }).strict(),
]);

export const MemoryScopeIdentitySchema = z.object({
  adopterId: MemoryScopeIdentityPartSchema,
  tenantId: MemoryScopeIdentityPartSchema,
  subjectId: MemoryScopeIdentityPartSchema,
  owner: MemoryScopeOwnerSchema,
}).strict();

export const MemoryScopeIdSchema = z
  .string()
  .regex(/^memory-v1-[a-f0-9]{64}$/)
  .brand('MemoryScopeId');

export type MemoryScopeIdentity = z.input<typeof MemoryScopeIdentitySchema>;
export type MemoryScopeId = z.infer<typeof MemoryScopeIdSchema>;

/**
 * Derives the stable, opaque address for one subject's Heddle memory.
 *
 * The authority boundary must supply adopter, tenant, and subject identifiers
 * from already verified identity. `owner` names the stable agent or workspace
 * whose memory is being addressed. Conversation and Runtime session ids are
 * intentionally absent so a fresh session resolves the same memory.
 *
 * This id is an address, not an authorization credential or a storage key
 * chosen by the caller. Storage adapters must still enforce tenant authority.
 */
export function deriveMemoryScopeId(identity: MemoryScopeIdentity): MemoryScopeId {
  const parsed = MemoryScopeIdentitySchema.parse(identity);
  const canonicalIdentity = JSON.stringify([
    'heddle-memory-scope',
    MEMORY_SCOPE_VERSION,
    parsed.adopterId,
    parsed.tenantId,
    parsed.subjectId,
    parsed.owner.kind,
    parsed.owner.id,
  ]);
  const digest = createHash('sha256').update(canonicalIdentity).digest('hex');

  return MemoryScopeIdSchema.parse(`memory-v${MEMORY_SCOPE_VERSION}-${digest}`);
}
