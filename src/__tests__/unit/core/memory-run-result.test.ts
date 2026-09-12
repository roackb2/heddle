import { describe, expect, it } from 'vitest';
import { projectMemoryRunResult } from '@/core/memory/run-result.js';
import type { TraceEvent } from '@/core/types.js';

const timestamp = '2026-09-12T00:00:00.000Z';

describe('projectMemoryRunResult', () => {
  it('reports a recorded candidate as a memory change', () => {
    const trace: TraceEvent[] = [{
      type: 'memory.candidate_recorded',
      candidateId: 'candidate-1',
      path: '_maintenance/candidates.jsonl',
      step: 1,
      timestamp,
    }];

    expect(projectMemoryRunResult(trace)).toEqual({ changed: true });
  });

  it('reports a successful direct memory edit as a memory change', () => {
    const trace: TraceEvent[] = [{
      type: 'tool.completed',
      call: { id: 'call-1', tool: 'edit_memory_note', input: {} },
      result: { ok: true, output: { path: 'projects/heddle.md' } },
      step: 1,
      timestamp,
    }];

    expect(projectMemoryRunResult(trace)).toEqual({ changed: true });
  });

  it('does not report failed edits, checkpoint skips, or unrelated tools as changes', () => {
    const trace: TraceEvent[] = [
      {
        type: 'tool.completed',
        call: { id: 'call-1', tool: 'edit_memory_note', input: {} },
        result: { ok: false, error: 'write failed' },
        step: 1,
        timestamp,
      },
      {
        type: 'memory.checkpoint_skipped',
        rationale: 'Nothing durable changed.',
        step: 2,
        timestamp,
      },
      {
        type: 'tool.completed',
        call: { id: 'call-2', tool: 'read_memory_note', input: {} },
        result: { ok: true, output: 'read only' },
        step: 3,
        timestamp,
      },
    ];

    expect(projectMemoryRunResult(trace)).toEqual({ changed: false });
    expect(projectMemoryRunResult([])).toEqual({ changed: false });
  });
});
