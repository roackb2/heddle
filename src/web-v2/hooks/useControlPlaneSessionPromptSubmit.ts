import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { trpcReact, type ControlPlaneSessionDetail } from '@web/api/client';
import { SessionMessageController } from '@web/controllers/session-messages';

type UseControlPlaneSessionPromptSubmitArgs = {
  sessionId?: string;
  streamConnected: boolean;
  setSession: Dispatch<SetStateAction<ControlPlaneSessionDetail>>;
  setRunning: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string | undefined>>;
  setLiveStatus: Dispatch<SetStateAction<string | undefined>>;
};

export type ControlPlaneSessionPromptSubmitState = {
  submitting: boolean;
  submitPrompt: (prompt: string) => Promise<void>;
};

// Owns prompt mutation state and optimistic conversation updates for web-v2.
export function useControlPlaneSessionPromptSubmit({
  sessionId,
  streamConnected,
  setSession,
  setRunning,
  setError,
  setLiveStatus,
}: UseControlPlaneSessionPromptSubmitArgs): ControlPlaneSessionPromptSubmitState {
  const [submitting, setSubmitting] = useState(false);
  const sessionSendPromptMutation = trpcReact.controlPlane.sessionSendPrompt.useMutation();

  useEffect(() => {
    setSubmitting(false);
  }, [sessionId]);

  const submitPrompt = useCallback(async (prompt: string) => {
    const trimmed = prompt.trim();
    if (!sessionId || !trimmed || submitting) {
      return;
    }

    setSubmitting(true);
    setRunning(true);
    setError(undefined);
    setLiveStatus(streamConnected ? 'Heddle is working...' : 'Heddle is working... reconnecting live stream if needed.');
    setSession((current) => SessionMessageController.appendOptimisticUserTurn(current, trimmed));

    try {
      const result = await sessionSendPromptMutation.mutateAsync({ sessionId, prompt: trimmed });
      setSession(result.session);
      setRunning(false);
      setLiveStatus(undefined);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
      setRunning(false);
      setLiveStatus(undefined);
    } finally {
      setSubmitting(false);
    }
  }, [
    sessionId,
    setError,
    setLiveStatus,
    setRunning,
    setSession,
    streamConnected,
    submitting,
    sessionSendPromptMutation,
  ]);

  return {
    submitting,
    submitPrompt,
  };
}
