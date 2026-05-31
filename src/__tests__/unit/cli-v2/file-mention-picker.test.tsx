// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useFileMentionPicker } from '../../../cli-v2/hooks/useFileMentionPicker.js';
import type {
  ControlPlaneSessionStore,
  ControlPlaneSessionStoreSnapshot,
} from '../../../cli-v2/state/control-plane-session-store.js';

describe('useFileMentionPicker', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces workspace file searches and inserts the highlighted result', async () => {
    vi.useFakeTimers();
    const searchWorkspaceFileMentions = vi.fn(async () => [
      { path: 'src/alpha.ts' },
      { path: 'src/beta.ts' },
    ]);
    const store = { searchWorkspaceFileMentions } as unknown as ControlPlaneSessionStore;

    const { result } = renderHook(() => {
      const [draft, setDraft] = useState('');
      const picker = useFileMentionPicker({
        draft,
        setDraft,
        snapshot: createSnapshot(),
        store,
      });

      return { draft, setDraft, picker };
    });

    act(() => {
      result.current.setDraft('@s');
      result.current.setDraft('@sr');
      result.current.setDraft('@src');
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(219);
    });
    expect(searchWorkspaceFileMentions).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await Promise.resolve();
    });

    expect(result.current.picker.suggestions).toHaveLength(2);
    expect(searchWorkspaceFileMentions).toHaveBeenCalledTimes(1);
    expect(searchWorkspaceFileMentions).toHaveBeenCalledWith('src', 20);

    act(() => {
      result.current.picker.handleSpecialKey('', { downArrow: true });
    });
    act(() => {
      result.current.picker.handleSpecialKey('', { tab: true });
    });

    expect(result.current.draft).toBe('@src/beta.ts ');
  });
});

function createSnapshot(): ControlPlaneSessionStoreSnapshot {
  return {
    workspaceId: 'workspace-1',
    sessions: [],
    activeSession: null,
    pendingApproval: null,
    loading: false,
    submitting: false,
    approvalResolving: false,
    running: false,
    cancelling: false,
    streamConnected: false,
    commandResults: [],
  };
}
