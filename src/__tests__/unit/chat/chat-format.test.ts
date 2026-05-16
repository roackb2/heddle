import { describe, expect, it } from 'vitest';
import {
  canRememberPendingApproval,
  formatApprovalHint,
  formatChatFailureMessage,
  formatEditPreviewHistoryMessage,
  formatPlanHistoryMessage,
  summarizePendingApproval,
} from '../../../cli/chat/utils/format.js';
import { ConversationLines } from '../../../core/chat/engine/sessions/records/index.js';
import type { ChatMessage } from '../../../core/llm/types.js';
import type { PendingApproval } from '../../../core/chat/types.js';

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

    const messages = ConversationLines.fromHistory(history);

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

    const messages = ConversationLines.fromHistory(history);

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

    const messages = ConversationLines.fromHistory(history);

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

describe('summarizePendingApproval', () => {
  it('shows the target path for path-aware tool approvals', () => {
    const pendingApproval: PendingApproval = {
      call: { id: 'call-1', tool: 'list_files', input: { path: 'src/cli/chat' } },
      tool: { name: 'list_files', description: 'List files', parameters: { type: 'object', properties: {} } },
      resolve: () => undefined,
    };

    const summary = summarizePendingApproval(pendingApproval);

    expect(summary.title).toBe('Allow list_files');
    expect(summary.command).toBe('src/cli/chat');
    expect(summary.why).toBe('list_files on src/cli/chat');
    expect(summary.effects).toContain('lists entries under src/cli/chat');
  });

  it('shows the search query for search_files approvals', () => {
    const pendingApproval: PendingApproval = {
      call: { id: 'call-1', tool: 'search_files', input: { query: 'approvalSubject', path: '../notes' } },
      tool: { name: 'search_files', description: 'Search files', parameters: { type: 'object', properties: {} } },
      resolve: () => undefined,
    };

    const summary = summarizePendingApproval(pendingApproval);

    expect(summary.title).toBe('Allow search_files');
    expect(summary.command).toBe('approvalSubject');
    expect(summary.scope).toBe('external');
    expect(summary.why).toBe('search_files for "approvalSubject" in ../notes');
    expect(summary.effects).toContain('searches ../notes for "approvalSubject"');
  });

  it('omits remember hint text when the approval cannot actually be remembered', () => {
    const pendingApproval: PendingApproval = {
      call: { id: 'call-1', tool: 'run_shell_inspect', input: { command: 'pwd' } },
      tool: { name: 'run_shell_inspect', description: 'Inspect shell', parameters: { type: 'object', properties: {} } },
      resolve: () => undefined,
    };

    expect(canRememberPendingApproval(pendingApproval)).toBe(false);
    expect(formatApprovalHint(pendingApproval)).toBe('Y approve once • N deny • Enter confirms selected choice');
  });

  it('uses a short path-tool remember label while keeping the path in the summary', () => {
    const pendingApproval: PendingApproval = {
      call: { id: 'call-1', tool: 'read_file', input: { path: '../notes/summary.md' } },
      tool: { name: 'read_file', description: 'Read file', parameters: { type: 'object', properties: {} } },
      rememberForProject: () => undefined,
      rememberLabel: 'allow read_file ../notes/summary.md for this project',
      resolve: () => undefined,
    };

    expect(canRememberPendingApproval(pendingApproval)).toBe(true);
    expect(formatApprovalHint(pendingApproval)).toContain('A allow read_file for this project');
    expect(formatApprovalHint(pendingApproval)).not.toContain('../notes/summary.md');
    expect(summarizePendingApproval(pendingApproval).command).toBe('../notes/summary.md');
  });

  it('uses a short remember label for exact shell commands without duplicating the full command', () => {
    const pendingApproval: PendingApproval = {
      call: { id: 'call-1', tool: 'run_shell_mutate', input: { command: 'git status --short --branch && git show --stat --oneline --no-patch HEAD' } },
      tool: { name: 'run_shell_mutate', description: 'Mutate shell', parameters: { type: 'object', properties: {} } },
      rememberForProject: () => undefined,
      rememberLabel: 'allow exact command',
      resolve: () => undefined,
    };

    const hint = formatApprovalHint(pendingApproval);
    expect(hint).toContain('A allow exact command');
    expect(hint).not.toContain('git status --short --branch');
    expect(summarizePendingApproval(pendingApproval).command).toBe('git status --short --branch && git show --stat --oneline --no-patch HEAD');
  });

  it('defensively shortens legacy exact-command remember labels that include the raw command', () => {
    const command = 'git status --short --branch && git show --stat --oneline --no-patch HEAD';
    const pendingApproval: PendingApproval = {
      call: { id: 'call-1', tool: 'run_shell_mutate', input: { command } },
      tool: { name: 'run_shell_mutate', description: 'Mutate shell', parameters: { type: 'object', properties: {} } },
      rememberForProject: () => undefined,
      rememberLabel: `allow exact command ${command} for this project`,
      resolve: () => undefined,
    };

    expect(formatApprovalHint(pendingApproval)).toBe('Y approve once • A allow exact command • N deny • Enter confirms selected choice');
    expect(summarizePendingApproval(pendingApproval).rememberLabel).toBe('allow exact command');
    expect(summarizePendingApproval(pendingApproval).command).toBe(command);
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
