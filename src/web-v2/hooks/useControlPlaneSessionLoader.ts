import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { trpc, type ControlPlaneSessionDetail } from '@web/api/client';
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

// Loads persisted session detail and preserves browser-only transient messages
// during silent refreshes triggered by session file or stream events.
export function useControlPlaneSessionLoader(sessionId: string | undefined): ControlPlaneSessionLoaderState {
  const [session, setSession] = useState<ControlPlaneSessionDetail>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const refresh = useCallback<RefreshControlPlaneSession>(async (id, options = {}) => {
    if (!options.silent) {
      setLoading(true);
    }

    try {
      const next = await trpc.controlPlane.session.query({ id });
      setSession((current) => (
        options.silent ? SessionMessageController.mergeTransientMessages(current, next) : next
      ));
      setError(undefined);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      if (!options.silent) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!sessionId) {
      setSession(null);
      setLoading(false);
      setError(undefined);
      return;
    }

    void refresh(sessionId);
  }, [refresh, sessionId]);

  return {
    session,
    loading,
    error,
    setSession,
    setError,
    refresh,
  };
}
