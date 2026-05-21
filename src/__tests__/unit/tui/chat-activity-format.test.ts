import { describe, expect, it } from 'vitest';
import { formatTuiConversationActivity } from '../../../cli/chat/adapters/conversation-activity-format.js';
import { ConversationActivityProjector, ToolActivitySummarizer } from '@/core/chat/engine/live/index.js';
import type { AgentLoopEvent } from '@/core/runtime/loop/index.js';
import type { TraceEvent } from '../../../types.js';

describe('chat activity formatting', () => {
  it('includes read_file paths in tool call summaries', () => {
    expect(ToolActivitySummarizer.summarizeCall({ tool: 'read_file', input: { path: 'docs/framework-vision.md' } })).toBe(
      'read_file (docs/framework-vision.md)',
    );
  });

  it('includes list_files paths in tool call summaries', () => {
    expect(ToolActivitySummarizer.summarizeCall({ tool: 'list_files', input: { path: 'src/cli/chat' } })).toBe(
      'list_files (src/cli/chat)',
    );
  });

  it('includes search_files query and path in tool call summaries', () => {
    expect(ToolActivitySummarizer.summarizeCall({ tool: 'search_files', input: { query: 'trace-1775195542429', path: '.heddle/traces' } })).toBe(
      'search_files ("trace-1775195542429" in .heddle/traces)',
    );
  });

  it('includes read paths in live activity events', () => {
    const event: TraceEvent = {
      type: 'tool.call',
      call: { id: 'call-1', tool: 'read_file', input: { path: 'README.md' } },
      step: 1,
      timestamp: '2024-01-01T00:00:00Z',
    };

    expect(ConversationActivityProjector.fromTraceEvent(event).map(formatTuiConversationActivity)).toEqual([
      'running read_file (README.md)',
    ]);
  });

  it('includes list paths in approval activity events', () => {
    const event: TraceEvent = {
      type: 'tool.approval_requested',
      call: { id: 'call-2', tool: 'list_files', input: { path: 'src' } },
      step: 2,
      timestamp: '2024-01-01T00:00:01Z',
    };

    expect(ConversationActivityProjector.fromTraceEvent(event).map(formatTuiConversationActivity)).toEqual([
      'approval needed for list_files (src)',
    ]);
  });

  it('includes search query details in live activity events', () => {
    const event: TraceEvent = {
      type: 'tool.call',
      call: { id: 'call-3', tool: 'search_files', input: { query: 'trace', path: '.heddle/traces' } },
      step: 3,
      timestamp: '2024-01-01T00:00:02Z',
    };

    expect(ConversationActivityProjector.fromTraceEvent(event).map(formatTuiConversationActivity)).toEqual([
      'running search_files ("trace" in .heddle/traces)',
    ]);
  });

  it('formats loop-level tool calling events with input details for immediate TUI activity', () => {
    const event: AgentLoopEvent = {
      type: 'tool.calling',
      runId: 'run-1',
      step: 1,
      tool: 'read_file',
      toolCallId: 'call-1',
      input: { path: 'README.md' },
      requiresApproval: false,
      timestamp: '2026-05-08T00:00:00.000Z',
    };

    expect(ConversationActivityProjector.fromAgentLoopEvent(event).map(formatTuiConversationActivity)).toEqual([
      'running read_file (README.md)',
    ]);
  });
});
