import { createHash } from 'node:crypto';
import { z } from 'zod';

export const WORKING_SET_SCOPE_VERSION = 1 as const;

const WorkingSetScopeIdentityPartSchema = z
  .string()
  .min(1)
  .max(256)
  .refine(value => value === value.trim(), 'must not contain outer whitespace');

/**
 * Stable verified identity used to address one agent's durable working set.
 * Runtime invocation ids are intentionally absent because they are ephemeral.
 */
export const WorkingSetScopeIdentitySchema = z.object({
  adopterId: WorkingSetScopeIdentityPartSchema,
  tenantId: WorkingSetScopeIdentityPartSchema,
  subjectId: WorkingSetScopeIdentityPartSchema,
  productSessionId: WorkingSetScopeIdentityPartSchema,
}).strict();

export const WorkingSetScopeIdSchema = z
  .string()
  .regex(/^working-set-v1-[a-f0-9]{64}$/u)
  .brand('WorkingSetScopeId');

export type WorkingSetScopeIdentity = z.input<typeof WorkingSetScopeIdentitySchema>;
export type WorkingSetScopeId = z.infer<typeof WorkingSetScopeIdSchema>;

/**
 * Derives an opaque durable address from identity claims already verified by
 * the hosting authority. The result is an address, never authorization.
 */
export function deriveWorkingSetScopeId(identity: WorkingSetScopeIdentity): WorkingSetScopeId {
  const parsed = WorkingSetScopeIdentitySchema.parse(identity);
  const canonicalIdentity = JSON.stringify([
    'heddle-working-set-scope',
    WORKING_SET_SCOPE_VERSION,
    parsed.adopterId,
    parsed.tenantId,
    parsed.subjectId,
    parsed.productSessionId,
  ]);
  const digest = createHash('sha256').update(canonicalIdentity).digest('hex');

  return WorkingSetScopeIdSchema.parse(`working-set-v${WORKING_SET_SCOPE_VERSION}-${digest}`);
}
