/** @vitest-environment jsdom */

import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const queryFixtures = vi.hoisted(() => ({
  state: {
    data: {
      activeWorkspaceId: 'workspace-1',
      workspaces: [{ id: 'workspace-1' }],
    },
  },
  sessions: {
    data: {
      workspaceId: 'workspace-1',
      resumeSessionId: 'session-recent',
      sessions: [
        {
          id: 'session-pinned',
          name: 'Pinned shortcut',
          pinned: true,
          messageCount: 1,
          turnCount: 1,
          queuedPromptCount: 0,
        },
        {
          id: 'session-recent',
          name: 'Recent work',
          pinned: false,
          messageCount: 1,
          turnCount: 1,
          queuedPromptCount: 0,
        },
      ],
    },
  },
  tasks: { data: { workspaceId: 'workspace-1', tasks: [] } },
}));

vi.mock('@web/api/client', () => ({
  trpcReact: {
    controlPlane: {
      state: { useQuery: () => queryFixtures.state },
      sessions: { useQuery: () => queryFixtures.sessions },
      heartbeatTasks: { useQuery: () => queryFixtures.tasks },
    },
  },
}));

import { useControlPlaneSidebarData } from '../../../web-v2/hooks/shell/useControlPlaneSidebarData.js';

describe('web-v2 useControlPlaneSidebarData', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('opens the resume candidate while preserving pinned-first display order', async () => {
    const selectSession = vi.fn();
    const navigation = {
      selectedWorkspaceId: 'workspace-1',
      selectedSessionId: undefined,
      selectedTaskId: undefined,
      settingsOpen: false,
      activeSurfaceId: 'sessions',
      selectSession,
      selectTask: vi.fn(),
    };

    const { result } = renderHook(() => useControlPlaneSidebarData({
      navigation: navigation as never,
      taskEvents: { liveTasks: {} } as never,
    }));

    await waitFor(() => {
      expect(selectSession).toHaveBeenCalledWith('session-recent', {
        workspaceId: 'workspace-1',
        replace: true,
      });
    });
    expect(result.current.sessions.map((session) => session.id)).toEqual([
      'session-pinned',
      'session-recent',
    ]);
  });
});
