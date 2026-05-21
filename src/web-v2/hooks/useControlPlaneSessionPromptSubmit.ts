import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { sendControlPlaneSessionPrompt, type ControlPlaneSessionDetail } from '@web/api/client';
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

  useEffect(() => {
    setSubmitting(false);
  }, [sessionId]);

  const submitPrompt = useCallback(async (prompt: string) => {
    const trimmed = prompt.trim();
    if (!sessionId || !trimmed || submitting) {
      return;
    }

    if (!streamConnected) {
      setLiveStatus('Connecting to the live session stream...');
      return;
    }

    setSubmitting(true);
    setRunning(true);
    setError(undefined);
    setLiveStatus('Heddle is working...');
    setSession((current) => SessionMessageController.appendOptimisticUserTurn(current, trimmed));

    try {
      const result = await sendControlPlaneSessionPrompt(sessionId, trimmed);
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
  }, [sessionId, setError, setLiveStatus, setRunning, setSession, streamConnected, submitting]);

  return {
    submitting,
    submitPrompt,
  };
}
