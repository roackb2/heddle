import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  ExecutionScopeSchema,
  OpaqueIdSchema,
  RuntimeSessionIdSchema,
} from '../contracts/index.js';

const ProductExecutionScopeSchema = ExecutionScopeSchema.omit({
  adopterId: true,
});

const HostedRuntimeSessionInputSchema = z.object({
  namespace: OpaqueIdSchema,
  scope: ProductExecutionScopeSchema,
}).strict();

/** Stable Runtime session identity derived only from product-owned scope. */
export function createHostedRuntimeSessionId(rawInput: {
  namespace: string;
  scope: z.infer<typeof ProductExecutionScopeSchema>;
}): string {
  const input = HostedRuntimeSessionInputSchema.parse(rawInput);
  const digest = createHash('sha256')
    .update(JSON.stringify([
      input.scope.tenantId,
      input.scope.subjectId,
      input.scope.productSessionId,
    ]))
    .digest('hex');
  return RuntimeSessionIdSchema.parse(
    `${input.namespace}-runtime-session-${digest}`,
  );
}
