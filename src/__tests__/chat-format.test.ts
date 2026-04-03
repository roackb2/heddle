import { describe, expect, it } from 'vitest';
import { buildConversationMessages } from '../cli/chat/utils/format.js';
import type { ChatMessage } from '../llm/types.js';

describe('buildConversationMessages', () => {
  it('renders successful edit_file tool results into visible conversation history', () => {
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
        content: JSON.stringify({
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
        }),
      },
      { role: 'assistant', content: 'Done.' },
    ];

    const messages = buildConversationMessages(history);

    expect(messages).toHaveLength(4);
    expect(messages[2]).toMatchObject({
      role: 'assistant',
      text: expect.stringContaining('## Edited `src/example.ts`'),
    });
    expect(messages[2]?.text).toContain('Action: replaced');
    expect(messages[2]?.text).toContain('Matches changed: 1');
    expect(messages[2]?.text).toContain('```diff');
    expect(messages[2]?.text).toContain('+const value = "new";');
  });

  it('does not render non-edit tool results into conversation history', () => {
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
        content: JSON.stringify({ ok: true, output: 'README.md\nsrc/' }),
      },
    ];

    const messages = buildConversationMessages(history);

    expect(messages).toEqual([
      { id: 'user-0-Inspect the repo.', role: 'user', text: 'Inspect the repo.' },
      { id: 'assistant-1-I will inspect.', role: 'assistant', text: 'I will inspect.' },
    ]);
  });
});
