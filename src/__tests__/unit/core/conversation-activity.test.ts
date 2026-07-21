import { describe, expect, it } from 'vitest';
import { ToolActivitySummarizer } from '@/core/live/index.js';
import type { ConversationActivity } from '@/core/live/index.js';

describe('conversation activity', () => {
  it('uses runtime-origin activity as the final conversation activity shape', () => {
    const activity: ConversationActivity = {
      source: 'agent-loop',
      type: 'assistant.stream',
      runId: 'run-1',
      step: 1,
      text: 'Working',
      done: false,
      timestamp: '2026-05-02T00:00:00.000Z',
    };

    expect(activity).toEqual({
      source: 'agent-loop',
      type: 'assistant.stream',
      runId: 'run-1',
      step: 1,
      text: 'Working',
      done: false,
      timestamp: '2026-05-02T00:00:00.000Z',
    });
  });

  it('keeps provider reasoning summaries separate from assistant response drafts', () => {
    const activity: ConversationActivity = {
      source: 'agent-loop',
      type: 'reasoning.summary',
      runId: 'run-1',
      step: 1,
      text: 'Inspecting the workspace before choosing a tool.',
      done: false,
      timestamp: '2026-05-02T00:00:00.000Z',
    };

    expect(activity).toMatchObject({
      type: 'reasoning.summary',
      text: 'Inspecting the workspace before choosing a tool.',
      done: false,
    });
  });

  it('keeps compaction activity in the final conversation activity shape', () => {
    const running: ConversationActivity = {
      source: 'compaction',
      type: 'compaction.running',
      status: 'running',
      archivePath: '.heddle/chat-sessions/session-1/archive.jsonl',
    };
    const failed: ConversationActivity = {
      source: 'compaction',
      type: 'compaction.failed',
      status: 'failed',
      error: 'summary failed',
    };

    expect(running).toEqual({
      source: 'compaction',
      type: 'compaction.running',
      status: 'running',
      archivePath: '.heddle/chat-sessions/session-1/archive.jsonl',
    });
    expect(failed).toEqual({
      source: 'compaction',
      type: 'compaction.failed',
      status: 'failed',
      error: 'summary failed',
    });
  });

  it('keeps approval and fallback activity in the final conversation activity shape', () => {
    const approval: ConversationActivity = {
      source: 'agent-loop',
      type: 'tool.approval_requested',
      runId: 'run-1',
      call: { id: 'call-1', tool: 'run_shell_mutate', input: { command: 'yarn test' } },
      step: 3,
      timestamp: '2026-05-02T00:00:00.000Z',
      derived: { kind: 'tool-summary', summary: 'run_shell_mutate (yarn test)' },
    };
    const fallback: ConversationActivity = {
      source: 'agent-loop',
      type: 'tool.fallback',
      runId: 'run-1',
      fromCall: { id: 'call-2', tool: 'run_shell_inspect', input: { command: 'git status --short' } },
      toCall: { id: 'call-3', tool: 'run_shell_mutate', input: { command: 'git status --short' } },
      reason: 'inspect policy rejected the command',
      step: 4,
      timestamp: '2026-05-02T00:00:01.000Z',
      derived: {
        kind: 'tool-fallback-summary',
        fromSummary: 'run_shell_inspect (git status --short)',
        toSummary: 'run_shell_mutate (git status --short)',
      },
    };

    expect(approval).toEqual(
      expect.objectContaining({
        type: 'tool.approval_requested',
        call: expect.objectContaining({ tool: 'run_shell_mutate' }),
        derived: { kind: 'tool-summary', summary: 'run_shell_mutate (yarn test)' },
      }),
    );
    expect(fallback).toEqual(
      expect.objectContaining({
        type: 'tool.fallback',
        derived: {
          kind: 'tool-fallback-summary',
          fromSummary: 'run_shell_inspect (git status --short)',
          toSummary: 'run_shell_mutate (git status --short)',
        },
      }),
    );
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
});
