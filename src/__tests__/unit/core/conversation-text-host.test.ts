import { describe, expect, it, vi } from 'vitest';
import { createConversationTextHost } from '@/core/chat/engine/index.js';
import type { ConversationTurnResultSummary } from '@/core/chat/engine/index.js';

describe('createConversationTextHost', () => {
  it('streams assistant deltas and formats default activity lines', () => {
    const write = vi.fn();
    const textHost = createConversationTextHost({ output: write });

    textHost.host.events?.onActivity?.({
      source: 'agent-loop',
      type: 'reasoning.summary',
      runId: 'run-1',
      step: 1,
      text: 'Inspecting',
      done: false,
      timestamp: '2026-07-02T00:00:00.000Z',
    });
    textHost.host.events?.onActivity?.({
      source: 'agent-loop',
      type: 'reasoning.summary',
      runId: 'run-1',
      step: 1,
      text: 'Inspecting the request.',
      done: true,
      timestamp: '2026-07-02T00:00:00.500Z',
    });
    textHost.host.events?.onActivity?.({
      source: 'agent-loop',
      type: 'assistant.stream',
      runId: 'run-1',
      step: 1,
      text: 'Hello',
      done: false,
      timestamp: '2026-07-02T00:00:00.000Z',
    });
    textHost.host.events?.onActivity?.({
      source: 'agent-loop',
      type: 'assistant.stream',
      runId: 'run-1',
      step: 1,
      text: 'Hello world',
      done: true,
      timestamp: '2026-07-02T00:00:01.000Z',
    });
    textHost.host.events?.onActivity?.({
      source: 'agent-loop',
      type: 'tool.completed',
      runId: 'run-1',
      step: 1,
      tool: 'create_report',
      toolCallId: 'call-1',
      result: { ok: true },
      durationMs: 12,
      timestamp: '2026-07-02T00:00:02.000Z',
    });

    expect(write.mock.calls.map((call) => call[0])).toEqual([
      'Thinking: Inspecting',
      ' the request.',
      '\n',
      'Hello',
      ' world',
      '[activity] tool create_report:ok\n',
    ]);
  });

  it('renders a host-facing turn summary', () => {
    const write = vi.fn();
    const textHost = createConversationTextHost({ output: write });
    const result: ConversationTurnResultSummary = {
      outcome: 'done',
      summary: 'Created a report.',
      session: {
        id: 'session-1',
        name: 'Report session',
        createdAt: '2026-07-02T00:00:00.000Z',
        updatedAt: '2026-07-02T00:00:00.000Z',
        messages: [],
        history: [],
        turns: [],
        queuedPrompts: [],
      },
      traceFile: '/repo/.heddle/traces/trace-1.json',
      artifacts: [{
        id: 'artifact-1',
        kind: 'source',
        path: '/repo/.heddle/artifacts/files/artifact-1.md',
        createdAt: '2026-07-02T00:00:00.000Z',
        updatedAt: '2026-07-02T00:00:00.000Z',
      }],
      toolResults: [{
        call: { id: 'call-1', tool: 'create_report', input: {} },
        result: { ok: true },
        step: 1,
        timestamp: '2026-07-02T00:00:01.000Z',
      }],
    };

    textHost.renderTurnResult(result);

    expect(write).toHaveBeenCalledWith([
      '',
      'Turn result',
      '-----------',
      'Outcome: done',
      'Session: session-1',
      'Trace file: /repo/.heddle/traces/trace-1.json',
      'Artifacts: artifact-1',
      'Tool calls: create_report:ok',
      'Summary: Created a report.',
      '',
    ].join('\n'));
  });
});
