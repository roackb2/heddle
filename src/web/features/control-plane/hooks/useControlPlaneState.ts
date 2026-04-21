import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createWorkspace as createWorkspaceRequest,
  fetchControlPlaneState,
  setActiveWorkspace as setActiveWorkspaceRequest,
  type ControlPlaneState,
} from '../../../lib/api';

export function useControlPlaneState() {
  const [state, setState] = useState<ControlPlaneState | undefined>();
  const [error, setError] = useState<string | undefined>();
  const lastSnapshotRef = useRef<string | undefined>(undefined);

  const refresh = useCallback(async () => {
    try {
      const next = await fetchControlPlaneState();
      const snapshot = JSON.stringify(next);
      if (lastSnapshotRef.current !== snapshot) {
        lastSnapshotRef.current = snapshot;
        setState(next);
      }
      setError(undefined);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
    }
  }, []);

  const setActiveWorkspace = useCallback(async (workspaceId: string) => {
    await setActiveWorkspaceRequest(workspaceId);
    await refresh();
  }, [refresh]);

  const createWorkspace = useCallback(async (input: {
    name: string;
    anchorRoot: string;
    repoRoots?: string[];
    setActive?: boolean;
  }) => {
    await createWorkspaceRequest(input);
    await refresh();
  }, [refresh]);

  useEffect(() => {
    let active = true;

    async function refreshIfActive() {
      if (!active) {
        return;
      }

      try {
        await refresh();
      } catch {
        if (!active) {
          return;
        }
      }
    }

    void refreshIfActive();
    const interval = window.setInterval(() => {
      void refreshIfActive();
    }, 10_000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [refresh]);

  return {
    state,
    error,
    refresh,
    setActiveWorkspace,
    createWorkspace,
  };
}
