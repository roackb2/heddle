import { z } from 'zod';
import { HeddleEventType } from '@/core/event-types.js';
import type { TraceEvent } from '@/core/types.js';

export const MemoryRunResultSchema = z.object({
  changed: z.boolean(),
});

export type MemoryRunResult = z.infer<typeof MemoryRunResultSchema>;

const DIRECT_MEMORY_MUTATION_TOOLS = new Set(['edit_memory_note']);

/**
 * Projects settled Heddle memory-tool activity into a checkpoint decision.
 * Arbitrary host tools and filesystem writes are intentionally outside this
 * portable receipt.
 */
export function projectMemoryRunResult(trace: readonly TraceEvent[]): MemoryRunResult {
  return {
    changed: trace.some((event) => (
      event.type === HeddleEventType.memoryCandidateRecorded
      || (
        event.type === HeddleEventType.toolCompleted
        && event.result.ok
        && DIRECT_MEMORY_MUTATION_TOOLS.has(event.call.tool)
      )
    )),
  };
}
