import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { trpcReact } from '@web/api/client';
import { useI18n } from '@web/i18n';
import {
  ClientSharedSessionActivityService,
  type ClientSharedAgentActivityStatus,
} from '@/client-shared/services/session-activities';
import { ClientSharedPromptInputService } from '@/client-shared/services/prompt-input';
import type { ControlPlaneSessionDirectShellPreflight } from '@/client-shared/api/types';

type UseControlPlaneSessionPromptSubmitArgs = {
  workspaceId?: string;
  sessionId?: string;
  running: boolean;
  streamConnected: boolean;
  setRunning: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string | undefined>>;
  setLiveStatus: Dispatch<SetStateAction<string | undefined>>;
  setCurrentActivity: Dispatch<SetStateAction<ClientSharedAgentActivityStatus | undefined>>;
};

export type ControlPlaneSessionPromptSubmitState = {
  submitting: boolean;
  submitPrompt: (prompt: string, options?: { agentProfileId?: string }) => Promise<void>;
  directShellConfirmation?: ControlPlaneSessionDirectShellPreflight;
  confirmDirectShell: () => Promise<void>;
  cancelDirectShellConfirmation: () => void;
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
  running,
  streamConnected,
  setRunning,
  setError,
  setLiveStatus,
  setCurrentActivity,
}: UseControlPlaneSessionPromptSubmitArgs): ControlPlaneSessionPromptSubmitState {
  const { t } = useI18n();
  const [submitting, setSubmitting] = useState(false);
  const [directShellConfirmation, setDirectShellConfirmation] = useState<ControlPlaneSessionDirectShellPreflight | undefined>();
  const activeSubmissionRef = useRef<PromptSubmission | null>(null);
  const submissionSequenceRef = useRef(0);
  const utils = trpcReact.useUtils();
  const sessionSendPromptMutation = trpcReact.controlPlane.sessionSendPromptAsync.useMutation();
  const sessionDirectShellMutation = trpcReact.controlPlane.sessionDirectShellAsync.useMutation();

  useEffect(() => {
    activeSubmissionRef.current = null;
    setSubmitting(false);
    setDirectShellConfirmation(undefined);
  }, [sessionId, workspaceId]);

  const submitToControlPlane = useCallback(async (input: {
    prompt: string;
    agentProfileId?: string;
    directShell?: { command: string; riskAccepted?: boolean };
  }) => {
    if (!workspaceId || !sessionId || submitting) {
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
    if (!running) {
      setLiveStatus(streamConnected ? 'Heddle is working...' : 'Heddle is working... reconnecting live stream if needed.');
      setCurrentActivity(ClientSharedSessionActivityService.createThinkingStatus());
    }

    try {
      if (input.directShell) {
        await sessionDirectShellMutation.mutateAsync({
          workspaceId,
          sessionId,
          command: input.directShell.command,
          riskAccepted: input.directShell.riskAccepted,
        });
      } else {
        await sessionSendPromptMutation.mutateAsync({
          workspaceId,
          sessionId,
          prompt: input.prompt,
          agentProfileId: input.agentProfileId,
        });
      }
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
    setError,
    setLiveStatus,
    setCurrentActivity,
    setRunning,
    running,
    sessionId,
    sessionDirectShellMutation,
    sessionSendPromptMutation,
    streamConnected,
    submitting,
    utils.controlPlane.session,
    utils.controlPlane.sessionRunState,
    utils.controlPlane.sessionRuntimeContext,
    utils.controlPlane.sessions,
    workspaceId,
  ]);

  const submitPrompt = useCallback(async (prompt: string, options?: { agentProfileId?: string }) => {
    const trimmed = prompt.trim();
    if (!workspaceId || !sessionId || !trimmed || submitting) {
      return;
    }

    const directShell = ClientSharedPromptInputService.parseDirectShellDraft(trimmed);
    if (directShell && !directShell.command) {
      setError(t('composer.directShell.errorEmpty'));
      return;
    }

    if (directShell && running) {
      setError(t('composer.directShell.errorRunActive'));
      return;
    }

    if (directShell) {
      const preflight = await utils.controlPlane.sessionDirectShellPreflight.fetch({
        workspaceId,
        sessionId,
        command: directShell.command,
      });
      if (preflight.risk === 'blocked') {
        setError(preflight.reason ?? t('composer.directShell.errorBlocked'));
        return;
      }
      if (preflight.risk === 'confirmRequired') {
        setDirectShellConfirmation(preflight);
        setError(undefined);
        return;
      }
      await submitToControlPlane({ prompt: trimmed, directShell: { command: directShell.command } });
      return;
    }

    await submitToControlPlane({ prompt: trimmed, agentProfileId: options?.agentProfileId });
  }, [
    running,
    sessionId,
    setError,
    submitToControlPlane,
    submitting,
    t,
    utils.controlPlane.sessionDirectShellPreflight,
    workspaceId,
  ]);

  const confirmDirectShell = useCallback(async () => {
    if (!directShellConfirmation) {
      return;
    }
    const command = directShellConfirmation.command;
    setDirectShellConfirmation(undefined);
    await submitToControlPlane({
      prompt: `!${command}`,
      directShell: { command, riskAccepted: true },
    });
  }, [directShellConfirmation, submitToControlPlane]);

  const cancelDirectShellConfirmation = useCallback(() => {
    setDirectShellConfirmation(undefined);
  }, []);

  return {
    submitting,
    submitPrompt,
    directShellConfirmation,
    confirmDirectShell,
    cancelDirectShellConfirmation,
  };
}
