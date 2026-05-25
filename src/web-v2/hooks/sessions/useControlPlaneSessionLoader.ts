import { skipToken } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { trpcReact, type ControlPlaneSessionDetail } from '@web/api/client';
import { SessionMessageController } from '@web/controllers/session-messages';

export type RefreshControlPlaneSession = (
  sessionId: string,
  options?: { silent?: boolean },
) => Promise<void>;

export type ControlPlaneSessionLoaderState = {
  session: ControlPlaneSessionDetail;
  loading: boolean;
  error?: string;
  setSession: Dispatch<SetStateAction<ControlPlaneSessionDetail>>;
  setError: Dispatch<SetStateAction<string | undefined>>;
  refresh: RefreshControlPlaneSession;
};

type UseControlPlaneSessionLoaderArgs = {
  workspaceId?: string;
  sessionId?: string;
};

// Loads persisted session detail through React Query and preserves browser-only
// transient messages during silent refreshes.
export function useControlPlaneSessionLoader({
  workspaceId,
  sessionId,
}: UseControlPlaneSessionLoaderArgs): ControlPlaneSessionLoaderState {
  const [session, setSession] = useState<ControlPlaneSessionDetail>(null);
  const [manualLoading, setManualLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const latestRefreshMode = useRef<'normal' | 'silent' | null>(null);

  const sessionQuery = trpcReact.controlPlane.session.useQuery(
    sessionId && workspaceId ? { id: sessionId, workspaceId } : skipToken,
    {
      enabled: Boolean(sessionId && workspaceId),
    },
  );

  useEffect(() => {
    latestRefreshMode.current = null;
    setSession(null);
    setManualLoading(false);
    setError(undefined);
  }, [sessionId, workspaceId]);

  const refresh = useCallback<RefreshControlPlaneSession>(async (id, options = {}) => {
    if (!id || id !== sessionId) {
      return;
    }

    if (!options.silent) {
      setManualLoading(true);
    }
    latestRefreshMode.current = options.silent ? 'silent' : 'normal';

    try {
      const nextResult = await sessionQuery.refetch();
      const next = nextResult.data;
      if (!next) {
        throw new Error('Session not available');
      }

      setSession((current) => (
        options.silent && isSameSessionAddress(current, next)
          ? SessionMessageController.mergeTransientMessages(current, next)
          : next
      ));
      setError(undefined);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      if (!options.silent) {
        setManualLoading(false);
      }
    }
  }, [sessionId, sessionQuery]);

  useEffect(() => {
    if (!sessionId || !workspaceId) {
      setSession(null);
      setManualLoading(false);
      setError(undefined);
      return;
    }

    if (!sessionQuery.data) {
      return;
    }

    const querySession = sessionQuery.data;
    setSession((current) => {
      if (latestRefreshMode.current === 'silent' && isSameSessionAddress(current, querySession)) {
        return SessionMessageController.mergeTransientMessages(current, querySession);
      }

      if (isSameSessionAddress(current, querySession)) {
        return SessionMessageController.mergeTransientMessages(current, querySession);
      }

      return querySession;
    });
    latestRefreshMode.current = null;
  }, [sessionId, sessionQuery.data, workspaceId]);

  useEffect(() => {
    if (sessionQuery.error) {
      setError(sessionQuery.error instanceof Error ? sessionQuery.error.message : String(sessionQuery.error));
    }
  }, [sessionQuery.error]);

  return {
    session,
    loading: manualLoading || sessionQuery.isLoading || sessionQuery.isFetching,
    error,
    setSession,
    setError,
    refresh,
  };
}

function isSameSessionAddress(
  current: ControlPlaneSessionDetail,
  next: NonNullable<ControlPlaneSessionDetail>,
): boolean {
  return current?.id === next.id && current.workspaceId === next.workspaceId;
}
