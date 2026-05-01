import { describe, expect, it } from 'vitest';
import { analyzeTrace } from '../../core/eval/trace-analyzer.js';
import type { TraceEvent } from '../../core/types.js';

describe('analyzeTrace', () => {
  it('extracts mutation, verification, and pre-mutation inspection metrics', () => {
    const trace: TraceEvent[] = [
      { type: 'run.started', goal: 'Fix it', timestamp: '2026-05-01T00:00:00.000Z' },
      {
        type: 'assistant.turn',
        content: '',
        requestedTools: true,
        step: 1,
        timestamp: '2026-05-01T00:00:01.000Z',
        toolCalls: [
          { id: 'read-1', tool: 'read_file', input: { path: 'src/app.ts' } },
        ],
      },
      {
        type: 'assistant.turn',
        content: '',
        requestedTools: true,
        step: 2,
        timestamp: '2026-05-01T00:00:02.000Z',
        toolCalls: [
          { id: 'edit-1', tool: 'edit_file', input: { path: 'src/app.ts' } },
        ],
      },
      {
        type: 'assistant.turn',
        content: '',
        requestedTools: true,
        step: 3,
        timestamp: '2026-05-01T00:00:03.000Z',
        toolCalls: [
          { id: 'test-1', tool: 'run_shell_mutate', input: { command: 'yarn test' } },
        ],
      },
      { type: 'tool.result', tool: 'run_shell_mutate', result: { ok: true, output: { exitCode: 0 } }, step: 3, timestamp: '2026-05-01T00:00:04.000Z' },
      { type: 'run.finished', outcome: 'done', summary: 'Fixed and verified.', step: 4, timestamp: '2026-05-01T00:00:05.000Z' },
    ];

    expect(analyzeTrace(trace)).toMatchObject({
      assistantTurns: 3,
      toolCalls: 3,
      mutations: 2,
      verificationCommandsAfterMutation: 1,
      firstMutationStep: 2,
      outcome: 'done',
      summary: 'Fixed and verified.',
      toolsByName: {
        read_file: 1,
        edit_file: 1,
        run_shell_mutate: 1,
      },
      readOrSearchBeforeMutation: ['read_file:src/app.ts'],
    });
  });
});
