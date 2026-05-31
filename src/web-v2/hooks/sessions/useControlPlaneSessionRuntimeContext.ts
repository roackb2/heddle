import { skipToken } from '@tanstack/react-query';
import { trpcReact, type ControlPlaneSessionRuntimeContext } from '@web/api/client';

type UseControlPlaneSessionRuntimeContextArgs = {
  workspaceId?: string;
  sessionId?: string;
  running: boolean;
};

export type ControlPlaneSessionRuntimeContextState = {
  runtimeContext?: ControlPlaneSessionRuntimeContext;
};

// Owns web-v2 consumption of control-plane runtime facts. Runtime fact
// ownership stays on the server; this hook only binds the shared API data to
// React Query so components can render interface-specific guidance/status.
export function useControlPlaneSessionRuntimeContext({
  workspaceId,
  sessionId,
  running,
}: UseControlPlaneSessionRuntimeContextArgs): ControlPlaneSessionRuntimeContextState {
  const runtimeContextQuery = trpcReact.controlPlane.sessionRuntimeContext.useQuery(
    sessionId && workspaceId ? { sessionId, workspaceId } : skipToken,
    {
      enabled: Boolean(sessionId && workspaceId),
      refetchInterval: running ? 1000 : false,
      refetchOnWindowFocus: false,
    },
  );

  return {
    runtimeContext: runtimeContextQuery.data,
  };
}
