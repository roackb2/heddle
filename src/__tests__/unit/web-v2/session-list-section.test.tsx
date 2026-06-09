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

    render(
      <I18nProvider>
        <SessionListSection
          selectedSessionId="session-1"
          sessions={[createSessionView()]}
          title="Recent sessions"
          onCreateSession={vi.fn()}
          onRenameSession={onRenameSession}
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
});

function createSessionView(): ControlPlaneSessionView {
  return {
    id: 'session-1',
    name: 'Original name',
    model: 'gpt-5',
  };
}
