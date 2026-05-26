import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { trpcReact, type ControlPlaneSessionDetail } from '@web/api/client';
import { ClientSharedSessionMessageController } from '@/client-shared/controllers/session-messages';

type UseControlPlaneSessionPromptSubmitArgs = {
  workspaceId?: string;
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

type PromptSubmission = {
  id: number;
  workspaceId: string;
  sessionId: string;
};

// Owns prompt mutation state and optimistic conversation updates for web-v2.
export function useControlPlaneSessionPromptSubmit({
  workspaceId,
  sessionId,
  streamConnected,
  setSession,
  setRunning,
  setError,
  setLiveStatus,
}: UseControlPlaneSessionPromptSubmitArgs): ControlPlaneSessionPromptSubmitState {
  const [submitting, setSubmitting] = useState(false);
  const activeSubmissionRef = useRef<PromptSubmission | null>(null);
  const submissionSequenceRef = useRef(0);
  const utils = trpcReact.useUtils();
  const sessionSendPromptMutation = trpcReact.controlPlane.sessionSendPrompt.useMutation();

  useEffect(() => {
    activeSubmissionRef.current = null;
    setSubmitting(false);
  }, [sessionId, workspaceId]);

  const submitPrompt = useCallback(async (prompt: string) => {
    const trimmed = prompt.trim();
    if (!workspaceId || !sessionId || !trimmed || submitting) {
      return;
    }

    const submission = {
      id: submissionSequenceRef.current + 1,
      workspaceId,
      sessionId,
    };
    submissionSequenceRef.current = submission.id;
    activeSubmissionRef.current = submission;

    const isCurrentSubmission = () => {
      const current = activeSubmissionRef.current;
      return Boolean(
        current
        && current.id === submission.id
        && current.workspaceId === submission.workspaceId
        && current.sessionId === submission.sessionId,
      );
    };

    setSubmitting(true);
    setRunning(true);
    setError(undefined);
    setLiveStatus(streamConnected ? 'Heddle is working...' : 'Heddle is working... reconnecting live stream if needed.');
    utils.controlPlane.session.setData(
      { id: sessionId, workspaceId },
      (current) => ClientSharedSessionMessageController.appendOptimisticUserTurn(current ?? null, trimmed),
    );
    setSession((current) => ClientSharedSessionMessageController.appendOptimisticUserTurn(current, trimmed));

    try {
      const result = await sessionSendPromptMutation.mutateAsync({ workspaceId, sessionId, prompt: trimmed });
      utils.controlPlane.session.setData(
        { id: submission.sessionId, workspaceId: submission.workspaceId },
        result.session,
      );
      if (isCurrentSubmission()) {
        setSession(result.session);
        setRunning(false);
        setLiveStatus(undefined);
      }
    } catch (submitError) {
      if (isCurrentSubmission()) {
        setError(submitError instanceof Error ? submitError.message : String(submitError));
        setRunning(false);
        setLiveStatus(undefined);
      }
    } finally {
      void Promise.all([
        utils.controlPlane.sessions.invalidate({ workspaceId: submission.workspaceId }),
        utils.controlPlane.session.invalidate({ id: submission.sessionId, workspaceId: submission.workspaceId }),
        utils.controlPlane.sessionRunning.invalidate({ id: submission.sessionId, workspaceId: submission.workspaceId }),
      ]).catch(() => undefined);

      if (isCurrentSubmission()) {
        activeSubmissionRef.current = null;
        setSubmitting(false);
      }
    }
  }, [
    sessionId,
    workspaceId,
    setError,
    setLiveStatus,
    setRunning,
    setSession,
    streamConnected,
    submitting,
    sessionSendPromptMutation,
    utils.controlPlane.session,
    utils.controlPlane.sessionRunning,
    utils.controlPlane.sessions,
  ]);

  return {
    submitting,
    submitPrompt,
  };
}
