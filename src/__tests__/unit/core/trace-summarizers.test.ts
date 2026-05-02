import { describe, expect, it } from 'vitest';
import type { TraceEvent } from '../../../core/types.js';
import {
  countAssistantSteps as countAssistantStepsFromCompatPath,
  summarizeTrace as summarizeTraceFromCompatPath,
} from '../../../core/chat/trace-summary.js';
import {
  countAssistantSteps,
  createTraceSummarizerRegistry,
  summarizeTrace,
} from '../../../core/observability/trace-summarizers.js';

describe('trace summarizers', () => {
  it('preserves current built-in trace summary output', () => {
    const trace: TraceEvent[] = [
      {
        type: 'run.started',
        goal: 'answer the user',
        timestamp: '2026-05-02T00:00:00.000Z',
      },
      {
        type: 'assistant.turn',
        content: 'I will inspect files.',
        requestedTools: true,
        diagnostics: {
          rationale: 'Need current workspace context before answering.',
        },
        toolCalls: [
          { id: 'call-1', tool: 'run_shell_inspect', input: { command: 'rg -n "TraceEvent" src' } },
          { id: 'call-2', tool: 'read_file', input: { path: 'README.md' } },
        ],
        step: 1,
        timestamp: '2026-05-02T00:00:01.000Z',
      },
      {
        type: 'assistant.turn',
        content: 'Done.',
        requestedTools: false,
        step: 2,
        timestamp: '2026-05-02T00:00:02.000Z',
      },
      {
        type: 'host.warning',
        code: 'actionless_completion',
        message: 'Action-oriented prompt finished with no tool activity.',
        step: 2,
        timestamp: '2026-05-02T00:00:03.000Z',
      },
      {
        type: 'tool.approval_requested',
        call: { id: 'call-3', tool: 'run_shell_mutate', input: { command: 'yarn test' } },
        step: 3,
        timestamp: '2026-05-02T00:00:04.000Z',
      },
      {
        type: 'tool.approval_resolved',
        call: { id: 'call-3', tool: 'run_shell_mutate', input: { command: 'yarn test' } },
        approved: false,
        reason: 'User denied in test',
        step: 3,
        timestamp: '2026-05-02T00:00:05.000Z',
      },
      {
        type: 'tool.fallback',
        fromCall: { id: 'call-4', tool: 'run_shell_inspect', input: { command: 'git status --short' } },
        toCall: { id: 'call-5', tool: 'run_shell_mutate', input: { command: 'git status --short' } },
        reason: 'inspect policy rejected the command',
        step: 4,
        timestamp: '2026-05-02T00:00:06.000Z',
      },
      {
        type: 'tool.call',
        call: { id: 'call-6', tool: 'read_file', input: { path: 'src/index.ts' } },
        step: 5,
        timestamp: '2026-05-02T00:00:07.000Z',
      },
      {
        type: 'tool.result',
        tool: 'read_file',
        result: { ok: true, output: 'contents' },
        step: 5,
        timestamp: '2026-05-02T00:00:08.000Z',
      },
      {
        type: 'tool.result',
        tool: 'run_shell_inspect',
        result: { ok: false, error: 'exit code 1' },
        step: 5,
        timestamp: '2026-05-02T00:00:09.000Z',
      },
      {
        type: 'memory.candidate_recorded',
        candidateId: 'candidate-1',
        path: 'memory/pending/candidate-1.md',
        step: 6,
        timestamp: '2026-05-02T00:00:10.000Z',
      },
      {
        type: 'memory.checkpoint_skipped',
        rationale: 'No durable information was found.',
        step: 6,
        timestamp: '2026-05-02T00:00:11.000Z',
      },
      {
        type: 'memory.maintenance_started',
        runId: 'maintenance-1',
        candidateIds: ['candidate-1', 'candidate-2'],
        step: 7,
        timestamp: '2026-05-02T00:00:12.000Z',
      },
      {
        type: 'memory.maintenance_finished',
        runId: 'maintenance-1',
        outcome: 'completed',
        summary: 'Processed candidates.',
        processedCandidateIds: ['candidate-1'],
        failedCandidateIds: [],
        step: 7,
        timestamp: '2026-05-02T00:00:13.000Z',
      },
      {
        type: 'memory.maintenance_failed',
        runId: 'maintenance-2',
        error: 'maintenance failed',
        candidateIds: ['candidate-3'],
        step: 8,
        timestamp: '2026-05-02T00:00:14.000Z',
      },
      {
        type: 'cyberloop.annotation',
        step: 8,
        frameKind: 'assistant',
        driftLevel: 'low',
        requestedHalt: false,
        metadata: {},
        timestamp: '2026-05-02T00:00:15.000Z',
      },
      {
        type: 'run.finished',
        outcome: 'completed',
        summary: 'Done.',
        step: 9,
        timestamp: '2026-05-02T00:00:16.000Z',
      },
    ];

    expect(summarizeTrace(trace)).toEqual([
      'reasoning: Need current workspace context before answering.',
      'assistant requested run_shell_inspect (rg -n "TraceEvent" src), read_file (README.md)',
      'assistant answered',
      'host warning actionless_completion: Action-oriented prompt finished with no tool activity.',
      'approval requested for run_shell_mutate (yarn test)',
      'approval denied for run_shell_mutate (yarn test) (User denied in test)',
      'fallback run_shell_inspect (git status --short) -> run_shell_mutate (git status --short) (inspect policy rejected the command)',
      'tool call read_file (src/index.ts)',
      'tool result read_file: ok',
      'tool result run_shell_inspect: exit code 1',
      'memory candidate recorded: candidate-1',
      'memory checkpoint skipped: No durable information was found.',
      'memory maintenance started: candidate-1, candidate-2',
      'memory maintenance finished: completed',
      'memory maintenance failed: maintenance failed',
      'run finished: completed',
    ]);
  });

  it('allows domain modules to override a trace event summarizer', () => {
    const registry = createTraceSummarizerRegistry({
      'tool.result': (event, context) => `custom ${context.index}:${event.tool}`,
    });

    expect(registry.summarizeTrace([
      {
        type: 'tool.result',
        tool: 'read_file',
        result: { ok: true, output: 'contents' },
        step: 1,
        timestamp: '2026-05-02T00:00:00.000Z',
      },
    ])).toEqual(['custom 0:read_file']);
  });

  it('preserves assistant step counting and the chat compatibility path', () => {
    const trace: TraceEvent[] = [
      { type: 'assistant.turn', content: 'One', requestedTools: false, step: 1, timestamp: '2026-05-02T00:00:00.000Z' },
      { type: 'run.finished', outcome: 'completed', summary: 'Done.', step: 1, timestamp: '2026-05-02T00:00:01.000Z' },
      { type: 'assistant.turn', content: 'Two', requestedTools: false, step: 2, timestamp: '2026-05-02T00:00:02.000Z' },
    ];

    expect(countAssistantSteps(trace)).toBe(2);
    expect(countAssistantStepsFromCompatPath(trace)).toBe(2);
    expect(summarizeTraceFromCompatPath(trace)).toEqual(summarizeTrace(trace));
  });
});
