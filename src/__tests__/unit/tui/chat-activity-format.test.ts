import { describe, expect, it } from 'vitest';
import { formatTuiConversationActivity } from '../../../cli/chat/adapters/conversation-activity-format.js';
import { ToolActivitySummarizer } from '@/core/live/index.js';
import type { ConversationActivity } from '@/core/live/index.js';

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
    const activity: ConversationActivity = {
      source: 'agent-loop',
      type: 'tool.calling',
      runId: 'run-1',
      step: 1,
      tool: 'read_file',
      toolCallId: 'call-1',
      input: { path: 'README.md' },
      requiresApproval: false,
      timestamp: '2024-01-01T00:00:00Z',
      derived: { kind: 'tool-summary', summary: 'read_file (README.md)' },
    };

    expect(formatTuiConversationActivity(activity)).toBe('running read_file (README.md)');
  });

  it('includes list paths in approval activity events', () => {
    const activity: ConversationActivity = {
      source: 'agent-loop',
      type: 'tool.approval_requested',
      runId: 'run-1',
      call: { id: 'call-2', tool: 'list_files', input: { path: 'src' } },
      step: 2,
      timestamp: '2024-01-01T00:00:01Z',
      derived: { kind: 'tool-summary', summary: 'list_files (src)' },
    };

    expect(formatTuiConversationActivity(activity)).toBe('approval needed for list_files (src)');
  });

  it('includes search query details in live activity events', () => {
    const activity: ConversationActivity = {
      source: 'agent-loop',
      type: 'tool.calling',
      runId: 'run-1',
      step: 3,
      tool: 'search_files',
      toolCallId: 'call-3',
      input: { query: 'trace', path: '.heddle/traces' },
      requiresApproval: false,
      timestamp: '2024-01-01T00:00:02Z',
      derived: { kind: 'tool-summary', summary: 'search_files ("trace" in .heddle/traces)' },
    };

    expect(formatTuiConversationActivity(activity)).toBe('running search_files ("trace" in .heddle/traces)');
  });

  it('formats loop-level tool calling events with input details for immediate TUI activity', () => {
    const activity: ConversationActivity = {
      source: 'agent-loop',
      type: 'tool.calling',
      runId: 'run-1',
      step: 1,
      tool: 'read_file',
      toolCallId: 'call-1',
      input: { path: 'README.md' },
      requiresApproval: false,
      timestamp: '2026-05-08T00:00:00.000Z',
    };

    expect(formatTuiConversationActivity(activity)).toBe('running read_file');
  });
});
