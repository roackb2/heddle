/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionListSection } from '../../../web-v2/components/navigation/SessionListSection.js';
import { I18nProvider } from '../../../web-v2/i18n/I18nProvider.js';
import type { ControlPlaneSessionView } from '../../../client-shared/api/types.js';

describe('web-v2 SessionListSection', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('opens the custom context menu on repeated right-clicks', async () => {
    const onRenameSession = vi.fn().mockResolvedValue(undefined);
    const onSetSessionArchived = vi.fn().mockResolvedValue(undefined);
    const onSetSessionPinned = vi.fn().mockResolvedValue(undefined);

    render(
      <I18nProvider>
        <SessionListSection
          selectedSessionId="session-1"
          sessions={[createSessionView()]}
          title="Recent sessions"
          onCreateSession={vi.fn()}
          onRenameSession={onRenameSession}
          onSetSessionArchived={onSetSessionArchived}
          onSetSessionPinned={onSetSessionPinned}
          onSelectSession={vi.fn()}
        />
      </I18nProvider>,
    );

    const row = screen.getByRole('button', { name: 'Original namegpt-5' });
    expect(fireEvent.contextMenu(row)).toBe(false);
    expect(await screen.findByRole('menuitem', { name: 'Rename' })).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('menuitem', { name: 'Rename' })).toBeNull();
    });

    expect(fireEvent.contextMenu(row)).toBe(false);

    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: 'Rename' })).toBeTruthy();
    });
  });

  it('keeps the pinned sessions section visible when there are no pinned sessions', () => {
    render(
      <I18nProvider>
        <SessionListSection
          selectedSessionId="session-1"
          sessions={[createSessionView()]}
          title="Recent sessions"
          onCreateSession={vi.fn()}
          onRenameSession={vi.fn()}
          onSetSessionArchived={vi.fn()}
          onSetSessionPinned={vi.fn()}
          onSelectSession={vi.fn()}
        />
      </I18nProvider>,
    );

    const pinnedLabel = screen.getByText('Pinned sessions');
    const recentLabel = screen.getByText('Recent sessions');
    expect(screen.getByText('No pinned sessions')).toBeTruthy();
    expect(
      pinnedLabel.compareDocumentPosition(recentLabel) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('renders pinned sessions above recent sessions and exposes unpin action', async () => {
    const onSetSessionPinned = vi.fn().mockResolvedValue(undefined);

    render(
      <I18nProvider>
        <SessionListSection
          selectedSessionId="session-2"
          sessions={[
            createSessionView({ id: 'session-2', name: 'Pinned session', pinned: true }),
            createSessionView({ id: 'session-1', name: 'Regular session' }),
          ]}
          title="Recent sessions"
          onCreateSession={vi.fn()}
          onRenameSession={vi.fn()}
          onSetSessionArchived={vi.fn()}
          onSetSessionPinned={onSetSessionPinned}
          onSelectSession={vi.fn()}
        />
      </I18nProvider>,
    );

    const pinnedLabel = screen.getByText('Pinned sessions');
    const recentLabel = screen.getByText('Recent sessions');
    expect(
      pinnedLabel.compareDocumentPosition(recentLabel) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    const pinnedRow = screen.getByRole('button', { name: 'Pinned sessiongpt-5' });
    expect(fireEvent.contextMenu(pinnedRow)).toBe(false);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Unpin session' }));

    expect(onSetSessionPinned).toHaveBeenCalledWith('session-2', false);
  });

  it('exposes archive action from the session context menu', async () => {
    const onSetSessionArchived = vi.fn().mockResolvedValue(undefined);

    render(
      <I18nProvider>
        <SessionListSection
          selectedSessionId="session-1"
          sessions={[createSessionView()]}
          title="Recent sessions"
          onCreateSession={vi.fn()}
          onRenameSession={vi.fn()}
          onSetSessionArchived={onSetSessionArchived}
          onSetSessionPinned={vi.fn()}
          onSelectSession={vi.fn()}
        />
      </I18nProvider>,
    );

    const row = screen.getByRole('button', { name: 'Original namegpt-5' });
    expect(fireEvent.contextMenu(row)).toBe(false);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Archive session' }));

    expect(onSetSessionArchived).toHaveBeenCalledWith('session-1', true);
  });
});

function createSessionView(overrides: Partial<ControlPlaneSessionView> = {}): ControlPlaneSessionView {
  return {
    id: 'session-1',
    name: 'Original name',
    model: 'gpt-5',
    pinned: false,
    messageCount: 0,
    turnCount: 0,
    queuedPromptCount: 0,
    ...overrides,
  };
}
