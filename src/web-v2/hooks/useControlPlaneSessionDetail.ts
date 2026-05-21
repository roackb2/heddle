import { useEffect, useState } from 'react';
import { trpc, type RouterOutputs } from '@web/api/client';

export type ControlPlaneSessionDetail = RouterOutputs['controlPlane']['session'];

type ControlPlaneSessionDetailState = {
  session: ControlPlaneSessionDetail;
  loading: boolean;
};

// useControlPlaneSessionDetail loads the selected conversation detail from the
// same control-plane endpoint that web-v1 uses.
export function useControlPlaneSessionDetail(sessionId: string | undefined): ControlPlaneSessionDetailState {
  const [state, setState] = useState<ControlPlaneSessionDetailState>({
    session: null,
    loading: false,
  });

  useEffect(() => {
    if (!sessionId) {
      setState({ session: null, loading: false });
      return;
    }

    let cancelled = false;
    const id = sessionId;
    setState((current) => ({ ...current, loading: true }));

    async function load() {
      const session = await trpc.controlPlane.session.query({ id });
      if (cancelled) {
        return;
      }

      setState({ session, loading: false });
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  return state;
}
