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

  it('renames a session inline after the context menu action', async () => {
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

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Original namegpt-5' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Rename' }));

    const input = screen.getByLabelText<HTMLInputElement>('Session name');
    expect(input.value).toBe('Original name');

    fireEvent.change(input, { target: { value: '  Renamed session  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(onRenameSession).toHaveBeenCalledWith('session-1', 'Renamed session');
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
