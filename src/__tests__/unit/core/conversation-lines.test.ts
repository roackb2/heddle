import { describe, expect, it } from 'vitest';
import { ConversationLines } from '@/core/chat/engine/sessions/records/index.js';
import type { ChatMessage } from '@/core/llm/types.js';

describe('ConversationLines', () => {
  it('does not render raw edit_file tool payloads into conversation history', () => {
    const payload = JSON.stringify({
      ok: true,
      output: {
        path: 'src/example.ts',
        action: 'replaced',
        matchCount: 1,
        bytesWritten: 42,
        diff: {
          path: 'src/example.ts',
          action: 'replaced',
          diff: ['--- a/src/example.ts', '+++ b/src/example.ts', '@@ -1 +1 @@', '-const value = "old";', '+const value = "new";'].join('\n'),
          truncated: false,
        },
      },
    });

    const history: ChatMessage[] = [
      { role: 'user', content: 'Update the file.' },
      {
        role: 'assistant',
        content: 'I will update the file.',
        toolCalls: [{ id: 'call-1', tool: 'edit_file', input: { path: 'src/example.ts', oldText: 'old', newText: 'new' } }],
      },
      {
        role: 'tool',
        toolCallId: 'call-1',
        content: payload,
      },
      { role: 'assistant', content: 'Done.' },
    ];

    expect(ConversationLines.fromHistory(history)).toEqual([
      { id: 'user-0-Update the file.', role: 'user', text: 'Update the file.' },
      { id: 'assistant-1-I will update the file.', role: 'assistant', text: 'I will update the file.' },
      { id: 'assistant-3-Done.', role: 'assistant', text: 'Done.' },
    ]);
  });

  it('does not render raw non-edit tool payloads into conversation history', () => {
    const payload = JSON.stringify({ ok: true, output: 'README.md\nsrc/' });
    const history: ChatMessage[] = [
      { role: 'user', content: 'Inspect the repo.' },
      {
        role: 'assistant',
        content: 'I will inspect.',
        toolCalls: [{ id: 'call-1', tool: 'list_files', input: { path: '.' } }],
      },
      {
        role: 'tool',
        toolCallId: 'call-1',
        content: payload,
      },
    ];

    expect(ConversationLines.fromHistory(history)).toEqual([
      { id: 'user-0-Inspect the repo.', role: 'user', text: 'Inspect the repo.' },
      { id: 'assistant-1-I will inspect.', role: 'assistant', text: 'I will inspect.' },
    ]);
  });

  it('does not render raw update_plan payloads into conversation history', () => {
    const payload = JSON.stringify({
      ok: true,
      output: {
        explanation: 'Tracking the next implementation slice.',
        plan: [
          { step: 'Inspect roadmap and runtime state', status: 'completed' },
          { step: 'Implement the next bounded capability', status: 'in_progress' },
          { step: 'Verify with tests and build', status: 'pending' },
        ],
      },
    });

    const history: ChatMessage[] = [
      { role: 'user', content: 'Move the project forward.' },
      {
        role: 'assistant',
        content: 'I will plan the work first.',
        toolCalls: [{ id: 'call-1', tool: 'update_plan', input: { plan: [{ step: 'Inspect roadmap', status: 'completed' }] } }],
      },
      {
        role: 'tool',
        toolCallId: 'call-1',
        content: payload,
      },
    ];

    expect(ConversationLines.fromHistory(history)).toEqual([
      { id: 'user-0-Move the project forward.', role: 'user', text: 'Move the project forward.' },
      { id: 'assistant-1-I will plan the work first.', role: 'assistant', text: 'I will plan the work first.' },
    ]);
  });
});
