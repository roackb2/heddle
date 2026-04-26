import { describe, expect, it } from 'vitest';
import {
  buildConversationMessages,
  formatChatFailureMessage,
  formatEditPreviewHistoryMessage,
  formatPlanHistoryMessage,
} from '../../cli/chat/utils/format.js';
import type { ChatMessage } from '../../core/llm/types.js';

describe('buildConversationMessages', () => {
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

    const messages = buildConversationMessages(history);

    expect(messages).toEqual([
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

    const messages = buildConversationMessages(history);

    expect(messages).toEqual([
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

    const messages = buildConversationMessages(history);

    expect(messages).toEqual([
      { id: 'user-0-Move the project forward.', role: 'user', text: 'Move the project forward.' },
      { id: 'assistant-1-I will plan the work first.', role: 'assistant', text: 'I will plan the work first.' },
    ]);
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

describe('formatChatFailureMessage', () => {
  it('adds manual compaction guidance for likely input-size TPM failures', () => {
    const formatted = formatChatFailureMessage(
      `429 {"type":"error","error":{"type":"rate_limit_error","message":"This request would exceed your organization's rate limit of 30,000 input tokens per minute. Please reduce the prompt length or the maximum tokens requested."}}`,
      { model: 'claude-sonnet-4-6', estimatedHistoryTokens: 18234 },
    );

    expect(formatted).toContain('input-token-per-minute limit');
    expect(formatted).toContain('18,234 tokens');
    expect(formatted).toContain('/compact, /clear, or /session new');
  });

  it('distinguishes OpenAI quota exhaustion from prompt-size issues', () => {
    const formatted = formatChatFailureMessage(
      'You exceeded your current quota, please check your plan and billing details.',
      { model: 'gpt-5.4' },
    );

    expect(formatted).toContain('quota or billing limit');
    expect(formatted).toContain('not a transient prompt-size issue');
  });
});
