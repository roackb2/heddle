/** @vitest-environment jsdom */

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ControlPlaneSessionView } from '../../../client-shared/api/types.js';
import { useInlineSessionRename } from '../../../web-v2/hooks/shell/useInlineSessionRename.js';

describe('web-v2 useInlineSessionRename', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('submits a trimmed renamed session', async () => {
    const onRenameSession = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useInlineSessionRename({
      emptyNameError: 'Enter a name',
      onRenameSession,
      sessions: [createSessionView()],
    }));

    act(() => {
      result.current.startRename(createSessionView());
      result.current.updateRenamingSessionName('  Renamed session  ');
    });
    await act(async () => {
      await result.current.submitRename();
    });

    expect(onRenameSession).toHaveBeenCalledWith('session-1', 'Renamed session');
    expect(result.current.renamingSession).toBeUndefined();
  });

  it('keeps editing and reports empty names next to the field', async () => {
    const onRenameSession = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useInlineSessionRename({
      emptyNameError: 'Enter a name',
      onRenameSession,
      sessions: [createSessionView()],
    }));

    act(() => {
      result.current.startRename(createSessionView());
      result.current.updateRenamingSessionName('   ');
    });
    await act(async () => {
      await result.current.submitRename();
    });

    expect(onRenameSession).not.toHaveBeenCalled();
    expect(result.current.renameError).toBe('Enter a name');
    expect(result.current.renamingSession?.id).toBe('session-1');
  });

  it('exits edit mode without submitting unchanged names', async () => {
    const onRenameSession = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useInlineSessionRename({
      emptyNameError: 'Enter a name',
      onRenameSession,
      sessions: [createSessionView()],
    }));

    act(() => {
      result.current.startRename(createSessionView());
      result.current.updateRenamingSessionName('Original name');
    });
    await act(async () => {
      await result.current.submitRename();
    });

    expect(onRenameSession).not.toHaveBeenCalled();
    expect(result.current.renamingSession).toBeUndefined();
  });
});

function createSessionView(): ControlPlaneSessionView {
  return {
    id: 'session-1',
    name: 'Original name',
    model: 'gpt-5',
    pinned: false,
    messageCount: 0,
    turnCount: 0,
    queuedPromptCount: 0,
  };
}
