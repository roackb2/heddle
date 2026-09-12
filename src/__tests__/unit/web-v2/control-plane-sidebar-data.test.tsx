/** @vitest-environment jsdom */

import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  heartbeatTasksUseQuery: vi.fn(),
  sessionsUseQuery: vi.fn(),
  stateUseQuery: vi.fn(),
}));

vi.mock('@web/api/client', () => ({
  trpcReact: {
    controlPlane: {
      heartbeatTasks: { useQuery: api.heartbeatTasksUseQuery },
      sessions: { useQuery: api.sessionsUseQuery },
      state: { useQuery: api.stateUseQuery },
    },
  },
}));

import { useControlPlaneSidebarData } from '../../../web-v2/hooks/shell/useControlPlaneSidebarData.js';

describe('useControlPlaneSidebarData', () => {
  beforeEach(() => {
    api.stateUseQuery.mockReturnValue({
      data: {
        activeWorkspaceId: 'workspace-1',
        workspaces: [{ id: 'workspace-1' }],
      },
    });
    api.sessionsUseQuery.mockReturnValue({
      data: {
        workspaceId: 'workspace-1',
        sessions: [
          {
            id: 'pinned-old',
            name: 'Pinned old',
            pinned: true,
            updatedAt: '2026-08-28T09:00:00.000Z',
            messageCount: 1,
            turnCount: 1,
            queuedPromptCount: 0,
          },
          {
            id: 'recent-work',
            name: 'Recent work',
            pinned: false,
            updatedAt: '2026-08-29T09:00:00.000Z',
            messageCount: 1,
            turnCount: 1,
            queuedPromptCount: 0,
          },
        ],
      },
    });
    api.heartbeatTasksUseQuery.mockReturnValue({
      data: { workspaceId: 'workspace-1', tasks: [] },
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('navigates to the recent session when the sessions route has no explicit selection', async () => {
    const selectSession = vi.fn();
    renderHook(() => useControlPlaneSidebarData({
      navigation: {
        activeSurfaceId: 'sessions',
        selectedSessionId: undefined,
        selectedTaskId: undefined,
        selectedWorkspaceId: 'workspace-1',
        settingsOpen: false,
        selectSession,
        selectTask: vi.fn(),
      } as never,
      taskEvents: { liveTasks: {} } as never,
    }));

    await waitFor(() => {
      expect(selectSession).toHaveBeenCalledWith('recent-work', {
        workspaceId: 'workspace-1',
        replace: true,
      });
    });
  });

  it('preserves an explicitly selected route session', async () => {
    const selectSession = vi.fn();
    renderHook(() => useControlPlaneSidebarData({
      navigation: {
        activeSurfaceId: 'sessions',
        selectedSessionId: 'pinned-old',
        selectedTaskId: undefined,
        selectedWorkspaceId: 'workspace-1',
        settingsOpen: false,
        selectSession,
        selectTask: vi.fn(),
      } as never,
      taskEvents: { liveTasks: {} } as never,
    }));

    await waitFor(() => {
      expect(api.sessionsUseQuery).toHaveBeenCalled();
    });
    expect(selectSession).not.toHaveBeenCalled();
  });
});
