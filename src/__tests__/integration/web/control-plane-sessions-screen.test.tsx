// @vitest-environment jsdom

import type { ComponentProps } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatSessionDetail, ChatTurnReview, ControlPlaneState } from '../../../web/lib/api.js';
import { SessionsScreen } from '../../../web/features/control-plane/screens/SessionsScreen.js';
import {
  fetchModelOptions,
  fetchWorkspaceChanges,
  fetchWorkspaceFileDiff,
  fetchWorkspaceFileSuggestions,
} from '../../../web/lib/api.js';

vi.mock('../../../web/lib/api.js', () => ({
  fetchModelOptions: vi.fn(),
  fetchWorkspaceChanges: vi.fn(),
  fetchWorkspaceFileDiff: vi.fn(),
  fetchWorkspaceFileSuggestions: vi.fn(),
}));

const sessionSummary: ControlPlaneState['sessions'][number] = {
  id: 'session-1',
  name: 'Session 1',
  workspaceId: 'default',
  updatedAt: '2026-04-26T00:00:00.000Z',
  model: 'gpt-5.1-codex',
  driftEnabled: true,
  driftLevel: 'low',
  messageCount: 1,
  turnCount: 1,
};

const sessionDetail: ChatSessionDetail = {
  ...sessionSummary,
  messages: [{
    id: 'message-1',
    role: 'assistant',
    text: 'Done.',
  }],
  turns: [{
    id: 'turn-1',
    prompt: 'Edit docs',
    outcome: 'done',
    summary: 'Updated docs.',
    steps: 1,
    traceFile: '/tmp/trace.json',
    events: [],
  }],
};

const turnReview: ChatTurnReview = {
  traceFile: '/tmp/trace.json',
  files: [{
    path: 'src/example.ts',
    status: 'modified',
    source: 'edit_file',
    patch: 'diff --git a/src/example.ts b/src/example.ts\n-old\n+turn',
    truncated: false,
  }],
  reviewCommands: [],
  verificationCommands: [],
  mutationCommands: [],
  approvals: [],
};

describe('SessionsScreen review UI', () => {
  const originalInnerWidth = window.innerWidth;

  beforeEach(() => {
    vi.clearAllMocks();
    setViewportWidth(1024);
    vi.mocked(fetchModelOptions).mockResolvedValue({ groups: [{ label: 'OpenAI', models: ['gpt-5.4', 'gpt-5.5-pro'], options: [{ id: 'gpt-5.4', disabled: false }, { id: 'gpt-5.5-pro', disabled: false }] }] });
    vi.mocked(fetchWorkspaceChanges).mockResolvedValue({
      vcs: 'git',
      clean: false,
      files: [{
        path: 'src/example.ts',
        status: 'modified',
        workingTreeStatus: 'M',
        additions: 1,
        deletions: 1,
      }],
    });
    vi.mocked(fetchWorkspaceFileDiff).mockResolvedValue({
      vcs: 'git',
      path: 'src/example.ts',
      patch: 'diff --git a/src/example.ts b/src/example.ts\n-old\n+new',
      truncated: false,
      binary: false,
    });
    vi.mocked(fetchWorkspaceFileSuggestions).mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
    setViewportWidth(originalInnerWidth);
  });

  it('renders current workspace diff separately from trace-backed turn review', async () => {
    render(
      <SessionsScreen
        sessions={[sessionSummary]}
        activeSession={sessionSummary}
        sessionDetail={sessionDetail}
        sessionDetailLoading={false}
        selectedSessionId="session-1"
        onSelectSession={() => undefined}
        selectedTurnId="turn-1"
        onSelectTurn={() => undefined}
        selectedTurn={sessionDetail.turns[0]}
        turnReview={turnReview}
        turnReviewLoading={false}
        sendingPrompt={false}
        runInFlight={false}
        memoryUpdating={false}
        auth={{
          preferApiKey: false,
          openai: { type: 'oauth', provider: 'openai', accountId: 'acct-12345678', expiresAt: Date.now() + 60_000 },
          anthropic: { type: 'missing', provider: 'anthropic' },
        }}
        onSendPrompt={async () => undefined}
        creatingSession={false}
        onCreateSession={async () => undefined}
        onContinueSession={async () => undefined}
        onCancelSessionRun={async () => undefined}
        onUpdateSessionSettings={async () => undefined}
        pendingApproval={null}
        onResolveApproval={async () => undefined}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Current workspace changes')).toBeTruthy();
      expect(screen.getByText('src/example.ts')).toBeTruthy();
      expect(screen.getByText(/diff --git a\/src\/example.ts/)).toBeTruthy();
      expect(screen.getByLabelText('Current workspace differs from captured turn')).toBeTruthy();
    });
    expect(screen.getByText('Turn history')).toBeTruthy();
    expect(screen.getByText('Evidence')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Summary' })).toBeNull();
    expect(fetchWorkspaceChanges).toHaveBeenCalledTimes(1);
    expect(fetchWorkspaceFileDiff).toHaveBeenCalledWith('src/example.ts');

    fireEvent.click(screen.getByRole('button', { name: 'Open full diff' }));
    expect(screen.getByRole('dialog', { name: /Current workspace diff/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => {
      expect(fetchWorkspaceChanges).toHaveBeenCalledTimes(2);
    });

    fireEvent.click(screen.getByRole('button', { name: 'model' }));
    const modelListbox = screen.getByRole('listbox', { name: 'Model options' });
    const unsupportedOption = within(modelListbox).getByRole('option', { name: /gpt-5.5-pro/i });
    expect(unsupportedOption.getAttribute('disabled')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Turn history' }));
    await waitFor(() => {
      expect(screen.getByText('Captured turn diff')).toBeTruthy();
      expect(screen.getByText('Raw turn patch')).toBeTruthy();
    });
  });

  it('preserves desktop composer submit and disabled key behavior', async () => {
    const onSendPrompt = vi.fn(async () => undefined);
    renderSessionsScreen({ onSendPrompt });

    const textarea = screen.getByPlaceholderText('Ask Heddle about this workspace') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '   ' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(onSendPrompt).not.toHaveBeenCalled();

    fireEvent.change(textarea, { target: { value: 'Explain the diff', selectionStart: 16 } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });
    fireEvent.keyDown(textarea, { key: 'Enter', altKey: true });
    expect(onSendPrompt).not.toHaveBeenCalled();

    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(onSendPrompt).toHaveBeenCalledWith('Explain the diff');
    await waitFor(() => {
      expect(textarea.value).toBe('');
    });

    fireEvent.change(textarea, { target: { value: 'Send from button', selectionStart: 16 } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSendPrompt).toHaveBeenLastCalledWith('Send from button');
    await waitFor(() => {
      expect(textarea.value).toBe('');
    });
  });

  it('preserves file mention lookup, keyboard selection, and insertion behavior', async () => {
    vi.mocked(fetchWorkspaceFileSuggestions).mockResolvedValue([
      { path: 'src/alpha.ts' },
      { path: 'src/beta.ts' },
    ]);
    renderSessionsScreen();

    const textarea = screen.getByPlaceholderText('Ask Heddle about this workspace') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '@src', selectionStart: 4 } });

    await waitFor(() => {
      expect(fetchWorkspaceFileSuggestions).toHaveBeenCalledWith('src');
      expect(screen.getByRole('listbox', { name: 'File suggestions' })).toBeTruthy();
    });

    fireEvent.keyDown(textarea, { key: 'ArrowDown' });
    await waitFor(() => {
      expect(screen.getByRole('option', { name: '@src/beta.ts' }).className).toContain('active');
    });
    fireEvent.keyDown(textarea, { key: 'Tab' });
    await waitFor(() => {
      expect(textarea.value).toBe('@src/beta.ts ');
    });
    expect(screen.queryByRole('listbox', { name: 'File suggestions' })).toBeNull();

    fireEvent.change(textarea, { target: { value: 'Review @src', selectionStart: 11 } });
    await waitFor(() => {
      expect(screen.getByRole('listbox', { name: 'File suggestions' })).toBeTruthy();
      expect(screen.getByRole('option', { name: '@src/alpha.ts' })).toBeTruthy();
    });
  });

  it('preserves desktop layout anchors, approval card, and run-state actions', async () => {
    renderSessionsScreen({
      runInFlight: true,
      pendingApproval: {
        tool: 'run_shell',
        callId: 'call-1',
        input: { cmd: 'yarn test' },
        requestedAt: '2026-04-26T00:00:00.000Z',
      },
    });

    expect(screen.getByText('Sessions')).toBeTruthy();
    expect(screen.getAllByText('Session 1').length).toBeGreaterThan(0);
    expect(screen.getByText('Current workspace changes')).toBeTruthy();
    expect(screen.getByLabelText('Resize sessions sidebar')).toBeTruthy();
    expect(screen.getByLabelText('Resize session inspector')).toBeTruthy();
    expect(screen.getByText('Approval required: run_shell')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Continue' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Cancel' }).hasAttribute('disabled')).toBe(false);
    expect(screen.getByRole('button', { name: 'Send' }).hasAttribute('disabled')).toBe(true);
  });

  it('preserves model selection callback behavior', async () => {
    vi.mocked(fetchModelOptions).mockResolvedValue({
      groups: [{
        label: 'OpenAI',
        models: ['gpt-5.4', 'gpt-5.5-pro'],
        options: [
          { id: 'gpt-5.4', disabled: false },
          { id: 'gpt-5.5-pro', disabled: false },
        ],
      }],
    });
    const onUpdateSessionSettings = vi.fn(async () => undefined);
    renderSessionsScreen({
      auth: {
        preferApiKey: true,
        openai: { type: 'api-key', provider: 'openai' },
        anthropic: { type: 'missing', provider: 'anthropic' },
      },
      onUpdateSessionSettings,
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'model' }).hasAttribute('disabled')).toBe(false);
    });
    fireEvent.click(screen.getByRole('button', { name: 'model' }));
    const modelListbox = screen.getByRole('listbox', { name: 'Model options' });
    fireEvent.click(within(modelListbox).getByRole('option', { name: 'gpt-5.4' }));
    expect(onUpdateSessionSettings).toHaveBeenCalledWith({ model: 'gpt-5.4' });
  });

  it('preserves mobile list, chat, and review navigation', async () => {
    setViewportWidth(500);
    const onSelectSession = vi.fn();
    renderSessionsScreen({
      activeSession: undefined,
      sessionDetail: null,
      selectedSessionId: undefined,
      selectedTurnId: undefined,
      selectedTurn: undefined,
      turnReview: null,
      onSelectSession,
    });

    expect(screen.getByRole('button', { name: /Session 1/ })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Session 1/ }));
    expect(onSelectSession).toHaveBeenCalledWith('session-1');
    await waitFor(() => {
      expect(screen.getByRole('navigation', { name: 'Session views' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Review' })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    await waitFor(() => {
      expect(screen.getByRole('navigation', { name: 'Review evidence tabs' })).toBeTruthy();
      expect(screen.getByText('Current workspace changes')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Chat' }));
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Message Heddle')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: '‹ Sessions' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Session 1/ })).toBeTruthy();
    });
  });
});

type SessionsScreenProps = ComponentProps<typeof SessionsScreen>;

function renderSessionsScreen(overrides: Partial<SessionsScreenProps> = {}) {
  const props: SessionsScreenProps = {
    sessions: [sessionSummary],
    activeSession: sessionSummary,
    sessionDetail,
    sessionDetailLoading: false,
    selectedSessionId: 'session-1',
    onSelectSession: () => undefined,
    selectedTurnId: 'turn-1',
    onSelectTurn: () => undefined,
    selectedTurn: sessionDetail.turns[0],
    turnReview,
    turnReviewLoading: false,
    sendingPrompt: false,
    runInFlight: false,
    memoryUpdating: false,
    auth: {
      preferApiKey: false,
      openai: { type: 'oauth', provider: 'openai', accountId: 'acct-12345678', expiresAt: Date.now() + 60_000 },
      anthropic: { type: 'missing', provider: 'anthropic' },
    },
    onSendPrompt: async () => undefined,
    creatingSession: false,
    onCreateSession: async () => undefined,
    onContinueSession: async () => undefined,
    onCancelSessionRun: async () => undefined,
    onUpdateSessionSettings: async () => undefined,
    pendingApproval: null,
    onResolveApproval: async () => undefined,
    ...overrides,
  };

  return render(<SessionsScreen {...props} />);
}

function setViewportWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: width,
  });
}
