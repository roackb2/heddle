/** @vitest-environment jsdom */

import React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ConversationPanel } from '@/cli-v2/components/ConversationPanel.js';
import type {
  ControlPlaneSessionDetail,
  ControlPlaneSessionRuntimeContext,
} from '@/client-shared/api/types.js';

describe('cli-v2 ConversationPanel', () => {
  it('renders the welcome guide when the session has no user turns yet', () => {
    const view = render(
      <ConversationPanel
        session={createSessionDetail({
          messages: [{ id: 'assistant-1', role: 'assistant', text: 'Ready.' }],
        })}
        runtimeContext={createRuntimeContext({
          welcomeGuide: {
            mode: 'conversation',
            hasProviderCredential: false,
            carriesTranscriptAcrossTurns: true,
          },
        })}
      />,
    );

    expect(view.container.textContent).toContain('Heddle conversational mode.');
    expect(view.container.textContent).toContain('Each turn runs the current agent loop and carries the transcript into the next turn.');
    expect(view.container.textContent).toContain('No provider credential detected.');
  });

  it('renders user turns and direct shell results from the active session detail', () => {
    const view = render(
      <ConversationPanel
        session={createSessionDetail({
          messages: [
            { id: 'message-1', role: 'assistant', text: 'Ready.' },
            { id: 'message-2', role: 'user', text: 'What changed?', isPending: true },
            {
              id: 'message-3',
              role: 'assistant',
              text: '',
              directShellResult: {
                outcome: 'done',
                command: 'git status --short',
                stdout: ' M src/index.ts',
                stderr: '',
                error: '',
                policy: { reason: 'local workspace inspection' },
              },
            },
          ],
        })}
        runtimeContext={createRuntimeContext()}
      />,
    );

    expect(view.container.textContent).toContain('You');
    expect(view.container.textContent).not.toContain('You (queued)');
    expect(view.container.textContent).toContain('What changed?');
    expect(view.container.textContent).toContain('done shell git status --short');
    expect(view.container.textContent).toContain('local workspace inspection');
    expect(view.container.textContent).toContain('stdout');
    expect(view.container.textContent).toContain('M src/index.ts');
  });

  it('renders assistant markdown for terminal output', () => {
    const view = render(
      <ConversationPanel
        session={createSessionDetail({
          messages: [
            {
              id: 'message-1',
              role: 'assistant',
              text: '## Current status\n\n- **Ready** to run\n\n```ts\nconst ok = true;\n```',
            },
          ],
        })}
        runtimeContext={createRuntimeContext()}
      />,
    );

    expect(view.container.textContent).toContain('## Current status');
    expect(view.container.textContent).toContain('* Ready to run');
    expect(view.container.textContent).toContain('const ok = true;');
    expect(view.container.textContent).not.toContain('```ts');
  });

  it('renders persisted turn activity groups collapsed by default', () => {
    const view = render(
      <ConversationPanel
        session={createSessionDetail({
          messages: [
            { id: 'message-1', role: 'user', text: 'Update docs' },
            { id: 'message-2', role: 'assistant', text: 'Done.' },
          ],
          turns: [
            {
              id: 'turn-1',
              prompt: 'Update docs',
              outcome: 'done',
              summary: 'Updated docs',
              steps: 2,
              traceFile: '/tmp/trace.json',
              events: [],
              presentation: {
                timelineItems: [
                  {
                    type: 'edit_diff',
                    id: 'turn-1:edit:call-1',
                    toolCallId: 'call-1',
                    path: 'docs/index.md',
                    action: 'replace',
                    patch: '@@ -1 +1 @@\n-old\n+new',
                    truncated: false,
                  },
                ],
              },
            },
          ],
        })}
        runtimeContext={createRuntimeContext()}
      />,
    );

    expect(view.container.textContent).toContain('Activity');
    expect(view.container.textContent).toContain('Agent tool activities');
    expect(view.container.textContent).toContain('1 item');
    expect(view.container.textContent).toContain('/a to expand');
    expect(view.container.textContent).not.toContain('docs/index.md');
    expect(view.container.textContent).not.toContain('+new');
  });

  it('renders persisted turn activity details when expanded', () => {
    const view = render(
      <ConversationPanel
        activityExpanded
        session={createSessionDetail({
          messages: [
            { id: 'message-1', role: 'user', text: 'Update docs' },
            { id: 'message-2', role: 'assistant', text: 'Done.' },
          ],
          turns: [
            {
              id: 'turn-1',
              prompt: 'Update docs',
              outcome: 'done',
              summary: 'Updated docs',
              steps: 2,
              traceFile: '/tmp/trace.json',
              events: [],
              presentation: {
                timelineItems: [
                  {
                    type: 'edit_diff',
                    id: 'turn-1:edit:call-1',
                    toolCallId: 'call-1',
                    path: 'docs/index.md',
                    action: 'replace',
                    patch: '@@ -1 +1 @@\n-old\n+new',
                    truncated: false,
                  },
                ],
              },
            },
          ],
        })}
        runtimeContext={createRuntimeContext()}
      />,
    );

    expect(view.container.textContent).toContain('/a to collapse');
    expect(view.container.textContent).toContain('Edit diff');
    expect(view.container.textContent).toContain('docs/index.md');
    expect(view.container.textContent).toContain('+new');
  });
});

function createSessionDetail(
  overrides: Partial<NonNullable<ControlPlaneSessionDetail>> = {},
): NonNullable<ControlPlaneSessionDetail> {
  return {
    id: 'session-1',
    name: 'Session 1',
    workspaceId: 'workspace-1',
    messageCount: 1,
    turnCount: 0,
    queuedPromptCount: 0,
    messages: [{ id: 'message-1', role: 'assistant', text: 'Ready.' }],
    turns: [],
    queuedPrompts: [],
    ...overrides,
  };
}

function createRuntimeContext(
  overrides: Partial<ControlPlaneSessionRuntimeContext> = {},
): ControlPlaneSessionRuntimeContext {
  return {
    workspaceId: 'workspace-1',
    sessionId: 'session-1',
    sessionName: 'Session 1',
    model: 'gpt-5.4',
    reasoningEffort: 'medium',
    effectiveReasoningEffort: 'medium',
    reasoningSupported: true,
    reasoningOptions: [],
    permissionMode: 'default',
    permissionModeOptions: [
      {
        id: 'default',
        label: 'Default',
        description: 'Use default permission behavior',
      },
    ],
    credentialSource: {
      type: 'oauth',
      provider: 'openai',
      accountId: 'acct-test',
      expiresAt: Date.now() + 60_000,
    },
    contextWindow: 400000,
    estimatedInputTokens: undefined,
    driftEnabled: false,
    running: false,
    welcomeGuide: {
      mode: 'conversation',
      hasProviderCredential: true,
      carriesTranscriptAcrossTurns: true,
    },
    ...overrides,
  };
}
