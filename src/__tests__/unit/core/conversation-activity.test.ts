import { describe, expect, it } from 'vitest';
import {
  ConversationActivityProjector,
  ToolActivitySummarizer,
} from '@/core/observability/index.js';
import type { AgentLoopEvent } from '@/core/runtime/loop/index.js';
import type { TraceEvent } from '../../../core/types.js';

describe('conversation activity projection', () => {
  it('projects assistant stream events from the agent loop', () => {
    const event: AgentLoopEvent = {
      type: 'assistant.stream',
      runId: 'run-1',
      step: 1,
      text: 'Working',
      done: false,
      timestamp: '2026-05-02T00:00:00.000Z',
    };

    expect(ConversationActivityProjector.fromAgentLoopEvent(event)).toEqual([
      expect.objectContaining({
        source: 'agent-loop',
        type: 'assistant.stream',
        event,
        correlation: expect.objectContaining({ runId: 'run-1', step: 1 }),
      }),
    ]);
  });

  it('projects loop started and finished events', () => {
    const started: AgentLoopEvent = {
      type: 'loop.started',
      runId: 'run-1',
      goal: 'answer',
      model: 'gpt-5.4',
      provider: 'openai',
      workspaceRoot: '/repo',
      timestamp: '2026-05-02T00:00:00.000Z',
    };
    const finishedTrace: TraceEvent = {
      type: 'run.finished',
      outcome: 'max_steps',
      summary: 'Stopped.',
      step: 5,
      timestamp: '2026-05-02T00:00:01.000Z',
    };

    expect(ConversationActivityProjector.fromAgentLoopEvent(started)).toEqual([expect.objectContaining({
      type: 'loop.started',
      event: started,
      correlation: expect.objectContaining({ runId: 'run-1' }),
    })]);
    expect(ConversationActivityProjector.fromTraceEvent(finishedTrace)).toEqual([
      expect.objectContaining({
        type: 'run.finished',
        event: finishedTrace,
        correlation: expect.objectContaining({ step: 5 }),
      }),
    ]);
  });

  it('projects tool calling and completion events from the agent loop', () => {
    const calling: AgentLoopEvent = {
      type: 'tool.calling',
      runId: 'run-1',
      step: 2,
      tool: 'read_file',
      toolCallId: 'call-1',
      input: { path: 'README.md' },
      requiresApproval: false,
      timestamp: '2026-05-02T00:00:00.000Z',
    };
    const completed: AgentLoopEvent = {
      type: 'tool.completed',
      runId: 'run-1',
      step: 2,
      tool: 'read_file',
      toolCallId: 'call-1',
      result: { ok: true, output: 'contents' },
      durationMs: 12.4,
      timestamp: '2026-05-02T00:00:01.000Z',
    };

    expect(ConversationActivityProjector.fromAgentLoopEvent(calling)).toEqual([
      expect.objectContaining({
        type: 'tool.calling',
        event: calling,
        correlation: expect.objectContaining({ step: 2, runId: 'run-1' }),
        derived: { kind: 'tool-summary', summary: 'read_file (README.md)' },
      }),
    ]);
    expect(ConversationActivityProjector.fromAgentLoopEvent(completed)).toEqual([
      expect.objectContaining({
        type: 'tool.completed',
        event: completed,
        correlation: expect.objectContaining({ step: 2, runId: 'run-1' }),
      }),
    ]);
  });

  it('projects trace approval and fallback activities with reusable tool summaries', () => {
    const approval: TraceEvent = {
      type: 'tool.approval_requested',
      call: { id: 'call-1', tool: 'run_shell_mutate', input: { command: 'yarn test' } },
      step: 3,
      timestamp: '2026-05-02T00:00:00.000Z',
    };
    const fallback: TraceEvent = {
      type: 'tool.fallback',
      fromCall: { id: 'call-2', tool: 'run_shell_inspect', input: { command: 'git status --short' } },
      toCall: { id: 'call-3', tool: 'run_shell_mutate', input: { command: 'git status --short' } },
      reason: 'inspect policy rejected the command',
      step: 4,
      timestamp: '2026-05-02T00:00:01.000Z',
    };

    expect(ConversationActivityProjector.fromTraceEvent(approval)).toEqual([
      expect.objectContaining({
        type: 'tool.approval_requested',
        event: approval,
        derived: { kind: 'tool-summary', summary: 'run_shell_mutate (yarn test)' },
        correlation: expect.objectContaining({ step: 3 }),
      }),
    ]);
    expect(ConversationActivityProjector.fromTraceEvent(fallback)).toEqual([
      expect.objectContaining({
        type: 'tool.fallback',
        event: fallback,
        derived: {
          kind: 'tool-fallback-summary',
          fromSummary: 'run_shell_inspect (git status --short)',
          toSummary: 'run_shell_mutate (git status --short)',
        },
        correlation: expect.objectContaining({ step: 4 }),
      }),
    ]);
  });

  it('projects memory trace activities used by host adapters', () => {
    const started: TraceEvent = {
      type: 'memory.maintenance_started',
      runId: 'memory-1',
      candidateIds: ['candidate-1', 'candidate-2'],
      step: 5,
      timestamp: '2026-05-02T00:00:00.000Z',
    };
    const finished: TraceEvent = {
      type: 'memory.maintenance_finished',
      runId: 'memory-1',
      outcome: 'completed',
      summary: 'Stored project context.',
      processedCandidateIds: ['candidate-1'],
      failedCandidateIds: [],
      step: 5,
      timestamp: '2026-05-02T00:00:01.000Z',
    };

    expect(ConversationActivityProjector.fromTraceEvent(started)).toEqual([
      expect.objectContaining({
        type: 'memory.maintenance_started',
        event: started,
        correlation: expect.objectContaining({ runId: 'memory-1', step: 5 }),
      }),
    ]);
    expect(ConversationActivityProjector.fromTraceEvent(finished)).toEqual([
      expect.objectContaining({
        type: 'memory.maintenance_finished',
        event: finished,
        correlation: expect.objectContaining({ runId: 'memory-1', step: 5 }),
      }),
    ]);
  });

  it('projects compaction status activities', () => {
    expect(ConversationActivityProjector.fromCompactionStatus({
      status: 'running',
      archivePath: '.heddle/chat-sessions/session-1/archive.jsonl',
    })).toEqual([
      { source: 'compaction', type: 'compaction.running', event: { status: 'running', archivePath: '.heddle/chat-sessions/session-1/archive.jsonl' } },
    ]);
    expect(ConversationActivityProjector.fromCompactionStatus({
      status: 'failed',
      error: 'summary failed',
    })).toEqual([
      { source: 'compaction', type: 'compaction.failed', event: { status: 'failed', error: 'summary failed' } },
    ]);
  });

  it('preserves TUI tool call summary details in the shared core helper', () => {
    expect(ToolActivitySummarizer.summarizeCall({ tool: 'search_files', input: { query: 'trace', path: '.heddle/traces' } })).toBe(
      'search_files ("trace" in .heddle/traces)',
    );
    expect(ToolActivitySummarizer.summarizeCall({ tool: 'update_plan', input: { plan: [{ step: 'Refactor projection', status: 'in_progress' }] } })).toBe(
      'update_plan (Refactor projection)',
    );
    expect(ToolActivitySummarizer.summarizeCall({ tool: 'delete_file', input: { path: 'tmp/generated-report.md' } })).toBe(
      'delete_file (tmp/generated-report.md)',
    );
    expect(ToolActivitySummarizer.summarizeCall({ tool: 'move_file', input: { from: 'docs/old.md', to: 'docs/archive/old.md' } })).toBe(
      'move_file (docs/old.md -> docs/archive/old.md)',
    );
    expect(ToolActivitySummarizer.summarizeResult({ tool: 'edit_file', result: { ok: true, output: { path: 'src/index.ts' } } })).toBe('edit_file (src/index.ts)');
    expect(ToolActivitySummarizer.summarizeResult({ tool: 'delete_file', result: { ok: true, output: { path: 'tmp/generated-report.md' } } })).toBe(
      'delete_file (tmp/generated-report.md)',
    );
  });

  it('routes nested trace loop events through the trace projector', () => {
    const trace: TraceEvent = {
      type: 'tool.call',
      call: { id: 'call-1', tool: 'read_file', input: { path: 'README.md' } },
      step: 2,
      timestamp: '2026-05-02T00:00:00.000Z',
    };
    const event: AgentLoopEvent = {
      type: 'trace',
      runId: 'run-1',
      event: trace,
      timestamp: '2026-05-02T00:00:01.000Z',
    };

    expect(ConversationActivityProjector.fromAgentLoopEvent(event)).toEqual([
      expect.objectContaining({
        type: 'tool.call',
        derived: { kind: 'tool-summary', summary: 'read_file (README.md)' },
        correlation: expect.objectContaining({ runId: 'run-1', step: 2 }),
      }),
    ]);
  });
});
