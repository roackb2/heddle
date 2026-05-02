import { describe, expect, it } from 'vitest';
import {
  projectAgentLoopEventToConversationActivities,
  projectCompactionStatusToConversationActivities,
  projectTraceEventToConversationActivities,
  summarizeActivityToolCall,
} from '../../../core/observability/conversation-activity.js';
import type { AgentLoopEvent } from '../../../core/runtime/events.js';
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

    expect(projectAgentLoopEventToConversationActivities(event)).toEqual([
      { type: 'assistant.stream', text: 'Working', done: false },
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

    expect(projectAgentLoopEventToConversationActivities(started)).toEqual([{ type: 'loop.started' }]);
    expect(projectTraceEventToConversationActivities(finishedTrace)).toEqual([
      { type: 'run.finished', outcome: 'max_steps' },
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

    expect(projectAgentLoopEventToConversationActivities(calling)).toEqual([
      { type: 'tool.calling', tool: 'read_file', step: 2 },
    ]);
    expect(projectAgentLoopEventToConversationActivities(completed)).toEqual([
      { type: 'tool.completed', tool: 'read_file', durationMs: 12.4 },
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

    expect(projectTraceEventToConversationActivities(approval)).toEqual([
      {
        type: 'tool.approval_requested',
        tool: 'run_shell_mutate',
        toolSummary: 'run_shell_mutate (yarn test)',
        step: 3,
        call: approval.call,
      },
    ]);
    expect(projectTraceEventToConversationActivities(fallback)).toEqual([
      {
        type: 'tool.fallback',
        fromTool: 'run_shell_inspect',
        toTool: 'run_shell_mutate',
        fromSummary: 'run_shell_inspect (git status --short)',
        toSummary: 'run_shell_mutate (git status --short)',
        reason: 'inspect policy rejected the command',
      },
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

    expect(projectTraceEventToConversationActivities(started)).toEqual([
      { type: 'memory.maintenance_started', candidateCount: 2 },
    ]);
    expect(projectTraceEventToConversationActivities(finished)).toEqual([
      { type: 'memory.maintenance_finished', outcome: 'completed', summary: 'Stored project context.' },
    ]);
  });

  it('projects compaction status activities', () => {
    expect(projectCompactionStatusToConversationActivities({
      status: 'running',
      archivePath: '.heddle/chat-sessions/session-1/archive.jsonl',
    })).toEqual([
      { type: 'compaction.running', archivePath: '.heddle/chat-sessions/session-1/archive.jsonl' },
    ]);
    expect(projectCompactionStatusToConversationActivities({
      status: 'failed',
      error: 'summary failed',
    })).toEqual([
      { type: 'compaction.failed', error: 'summary failed' },
    ]);
  });

  it('preserves TUI tool call summary details in the shared core helper', () => {
    expect(summarizeActivityToolCall('search_files', { query: 'trace', path: '.heddle/traces' })).toBe(
      'search_files ("trace" in .heddle/traces)',
    );
    expect(summarizeActivityToolCall('update_plan', { plan: [{ step: 'Refactor projection', status: 'in_progress' }] })).toBe(
      'update_plan (Refactor projection)',
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

    expect(projectAgentLoopEventToConversationActivities(event)).toEqual([
      { type: 'tool.call', toolSummary: 'read_file (README.md)' },
    ]);
  });
});
