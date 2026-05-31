import { useCallback, type Dispatch, type SetStateAction } from 'react';
import { trpcReact, type ControlPlaneSessionDetail } from '@web/api/client';

type UseControlPlaneQueuedPromptsArgs = {
  workspaceId?: string;
  sessionId?: string;
  setSession: Dispatch<SetStateAction<ControlPlaneSessionDetail>>;
  setError: Dispatch<SetStateAction<string | undefined>>;
};

// Owns web-v2 queued-prompt mutations. The queue itself is persisted by the
// core session service; this hook only sends edit/delete intents and syncs the
// selected-session cache with the API result.
export function useControlPlaneQueuedPrompts({
  workspaceId,
  sessionId,
  setSession,
  setError,
}: UseControlPlaneQueuedPromptsArgs) {
  const utils = trpcReact.useUtils();
  const updateMutation = trpcReact.controlPlane.sessionQueuedPromptUpdate.useMutation();
  const deleteMutation = trpcReact.controlPlane.sessionQueuedPromptDelete.useMutation();

  const syncSession = useCallback((session: NonNullable<ControlPlaneSessionDetail>) => {
    setSession(session);
    if (workspaceId) {
      utils.controlPlane.session.setData({ id: session.id, workspaceId }, session);
    }
  }, [setSession, utils.controlPlane.session, workspaceId]);

  const updateQueuedPrompt = useCallback(async (queueItemId: string, prompt: string) => {
    if (!workspaceId || !sessionId) {
      return;
    }

    try {
      const session = await updateMutation.mutateAsync({ workspaceId, sessionId, queueItemId, prompt });
      syncSession(session);
      setError(undefined);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  }, [sessionId, setError, syncSession, updateMutation, workspaceId]);

  const deleteQueuedPrompt = useCallback(async (queueItemId: string) => {
    if (!workspaceId || !sessionId) {
      return;
    }

    try {
      const session = await deleteMutation.mutateAsync({ workspaceId, sessionId, queueItemId });
      syncSession(session);
      setError(undefined);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  }, [deleteMutation, sessionId, setError, syncSession, workspaceId]);

  return {
    queueUpdating: updateMutation.isPending || deleteMutation.isPending,
    updateQueuedPrompt,
    deleteQueuedPrompt,
  };
}
