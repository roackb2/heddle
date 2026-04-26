import { describe, expect, it } from 'vitest';
import { summarizeToolCall, toLiveEvent } from '../../cli/chat/utils/format.js';
import type { TraceEvent } from '../../types.js';

describe('chat activity formatting', () => {
  it('includes read_file paths in tool call summaries', () => {
    expect(summarizeToolCall('read_file', { path: 'docs/framework-vision.md' })).toBe(
      'read_file (docs/framework-vision.md)',
    );
  });

  it('includes list_files paths in tool call summaries', () => {
    expect(summarizeToolCall('list_files', { path: 'src/cli/chat' })).toBe(
      'list_files (src/cli/chat)',
    );
  });

  it('includes search_files query and path in tool call summaries', () => {
    expect(summarizeToolCall('search_files', { query: 'trace-1775195542429', path: '.heddle/traces' })).toBe(
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

    expect(toLiveEvent(event)).toBe('running read_file (README.md)');
  });

  it('includes list paths in approval activity events', () => {
    const event: TraceEvent = {
      type: 'tool.approval_requested',
      call: { id: 'call-2', tool: 'list_files', input: { path: 'src' } },
      step: 2,
      timestamp: '2024-01-01T00:00:01Z',
    };

    expect(toLiveEvent(event)).toBe('approval needed for list_files (src)');
  });

  it('includes search query details in live activity events', () => {
    const event: TraceEvent = {
      type: 'tool.call',
      call: { id: 'call-3', tool: 'search_files', input: { query: 'trace', path: '.heddle/traces' } },
      step: 3,
      timestamp: '2024-01-01T00:00:02Z',
    };

    expect(toLiveEvent(event)).toBe('running search_files ("trace" in .heddle/traces)');
  });
});
