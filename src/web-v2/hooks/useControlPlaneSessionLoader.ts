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

// Loads persisted session detail through React Query and preserves browser-only
// transient messages during silent refreshes.
export function useControlPlaneSessionLoader(sessionId: string | undefined): ControlPlaneSessionLoaderState {
  const [session, setSession] = useState<ControlPlaneSessionDetail>(null);
  const [manualLoading, setManualLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const latestRefreshMode = useRef<'normal' | 'silent' | null>(null);

  const sessionQuery = trpcReact.controlPlane.session.useQuery(
    sessionId ? { id: sessionId } : skipToken,
    {
      enabled: Boolean(sessionId),
    },
  );

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
        options.silent ? SessionMessageController.mergeTransientMessages(current, next) : next
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
    if (!sessionId) {
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
      if (latestRefreshMode.current === 'silent' && current?.id === querySession.id) {
        return current;
      }

      return querySession;
    });
    latestRefreshMode.current = null;
  }, [sessionId, sessionQuery.data]);

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
