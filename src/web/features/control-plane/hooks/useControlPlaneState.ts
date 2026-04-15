import { useEffect, useState } from 'react';
import { fetchControlPlaneState, type ControlPlaneState } from '../../../lib/api';

export function useControlPlaneState() {
  const [state, setState] = useState<ControlPlaneState | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      try {
        const next = await fetchControlPlaneState();
        if (!cancelled) {
          setState(next);
          setError(undefined);
        }
      } catch (refreshError) {
        if (!cancelled) {
          setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
        }
      }
    }

    void refresh();
    const interval = window.setInterval(() => {
      void refresh();
    }, 10_000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  return {
    state,
    error,
  };
}
