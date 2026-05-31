import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { trpcReact } from '@web/api/client';
import {
  ClientSharedSessionActivityService,
  type ClientSharedAgentActivityStatus,
} from '@/client-shared/services/session-activities';

type UseControlPlaneSessionPromptSubmitArgs = {
  workspaceId?: string;
  sessionId?: string;
  streamConnected: boolean;
  setRunning: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string | undefined>>;
  setLiveStatus: Dispatch<SetStateAction<string | undefined>>;
  setCurrentActivity: Dispatch<SetStateAction<ClientSharedAgentActivityStatus | undefined>>;
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
  setRunning,
  setError,
  setLiveStatus,
  setCurrentActivity,
}: UseControlPlaneSessionPromptSubmitArgs): ControlPlaneSessionPromptSubmitState {
  const [submitting, setSubmitting] = useState(false);
  const activeSubmissionRef = useRef<PromptSubmission | null>(null);
  const submissionSequenceRef = useRef(0);
  const utils = trpcReact.useUtils();
  const sessionSendPromptMutation = trpcReact.controlPlane.sessionSendPromptAsync.useMutation();

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
    setCurrentActivity(ClientSharedSessionActivityService.createThinkingStatus());

    try {
      await sessionSendPromptMutation.mutateAsync({ workspaceId, sessionId, prompt: trimmed });
      if (isCurrentSubmission()) {
        setRunning(true);
        setLiveStatus((current) => (
          current ?? (streamConnected ? 'Heddle is working...' : 'Heddle is working... reconnecting live stream if needed.')
        ));
      }
    } catch (submitError) {
      if (isCurrentSubmission()) {
        setError(submitError instanceof Error ? submitError.message : String(submitError));
        setRunning(false);
        setLiveStatus(undefined);
        setCurrentActivity(undefined);
      }
    } finally {
      void Promise.all([
        utils.controlPlane.sessions.invalidate({ workspaceId: submission.workspaceId }),
        utils.controlPlane.session.invalidate({ id: submission.sessionId, workspaceId: submission.workspaceId }),
        utils.controlPlane.sessionRunState.invalidate({ id: submission.sessionId, workspaceId: submission.workspaceId }),
        utils.controlPlane.sessionRuntimeContext.invalidate({ sessionId: submission.sessionId, workspaceId: submission.workspaceId }),
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
    setCurrentActivity,
    setRunning,
    streamConnected,
    submitting,
    sessionSendPromptMutation,
    utils.controlPlane.session,
    utils.controlPlane.sessionRunState,
    utils.controlPlane.sessionRuntimeContext,
    utils.controlPlane.sessions,
  ]);

  return {
    submitting,
    submitPrompt,
  };
}
