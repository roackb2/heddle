import { describe, expect, it } from 'vitest';
import { buildConversationMessages, formatEditPreviewHistoryMessage, formatPlanHistoryMessage } from '../cli/chat/utils/format.js';
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

  it('renders update_plan tool results into visible checklist history', () => {
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
        content: JSON.stringify({
          ok: true,
          output: {
            explanation: 'Tracking the next implementation slice.',
            plan: [
              { step: 'Inspect roadmap and runtime state', status: 'completed' },
              { step: 'Implement the next bounded capability', status: 'in_progress' },
              { step: 'Verify with tests and build', status: 'pending' },
            ],
          },
        }),
      },
    ];

    const messages = buildConversationMessages(history);

    expect(messages).toHaveLength(3);
    expect(messages[2]?.text).toContain('## Plan');
    expect(messages[2]?.text).toContain('Tracking the next implementation slice.');
    expect(messages[2]?.text).toContain('- [x] Inspect roadmap and runtime state');
    expect(messages[2]?.text).toContain('- [-] Implement the next bounded capability');
    expect(messages[2]?.text).toContain('- [ ] Verify with tests and build');
  });

  it('formats a live edit preview into the same visible diff block shape', () => {
    const rendered = formatEditPreviewHistoryMessage({
      path: 'src/example.ts',
      action: 'replaced',
      diff: ['--- a/src/example.ts', '+++ b/src/example.ts', '@@ -1 +1 @@', '-old', '+new'].join('\n'),
      truncated: false,
    });

    expect(rendered).toContain('## Edited `src/example.ts`');
    expect(rendered).toContain('Action: replaced');
    expect(rendered).toContain('```diff');
    expect(rendered).toContain('+new');
  });

  it('formats a live plan update into the same visible checklist block shape', () => {
    const rendered = formatPlanHistoryMessage({
      explanation: 'Tracking the current implementation slice.',
      plan: [
        { step: 'Inspect runtime behavior', status: 'completed' },
        { step: 'Implement the fix', status: 'in_progress' },
        { step: 'Verify with tests', status: 'pending' },
      ],
    });

    expect(rendered).toContain('## Plan');
    expect(rendered).toContain('Tracking the current implementation slice.');
    expect(rendered).toContain('- [x] Inspect runtime behavior');
    expect(rendered).toContain('- [-] Implement the fix');
    expect(rendered).toContain('- [ ] Verify with tests');
  });
});
