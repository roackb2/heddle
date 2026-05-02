import { useCallback, type Dispatch, type SetStateAction } from 'react';
import {
  cancelChatSession,
  continueChatSession,
  createChatSession,
  fetchPendingSessionApproval,
  resolvePendingSessionApproval,
  sendChatSessionPrompt,
  updateChatSessionSettings,
  type ChatSessionDetail,
  type ChatTurnReview,
  type PendingSessionApproval,
} from '../../../../lib/api';
import type { ToastInput } from '../../../../components/ui/use-toast';

type LiveSessionMessageActions = {
  appendPendingUserTurn: (prompt: string) => void;
  upsertLiveStatusMessage: (id: string, text: string, options?: { pending?: boolean; streaming?: boolean }) => void;
  removeLiveStatusMessage: (id: string) => void;
};

export function useSessionMutations({
  selectedSessionId,
  pendingApproval,
  sendingPrompt,
  runInFlight,
  notify,
  setSelectedSessionId,
  setSelectedTurnId,
  setSessionDetail,
  setSessionDetailError,
  setSendingPrompt,
  setSendPromptError,
  setTurnReview,
  setPendingApproval,
  setRunInFlight,
  setCreatingSession,
  setSessionNotice,
  liveMessages,
}: {
  selectedSessionId?: string;
  pendingApproval: PendingSessionApproval;
  sendingPrompt: boolean;
  runInFlight: boolean;
  notify?: (toast: ToastInput) => void;
  setSelectedSessionId: (sessionId?: string) => void;
  setSelectedTurnId: Dispatch<SetStateAction<string | undefined>>;
  setSessionDetail: Dispatch<SetStateAction<ChatSessionDetail | null>>;
  setSessionDetailError: Dispatch<SetStateAction<string | undefined>>;
  setSendingPrompt: Dispatch<SetStateAction<boolean>>;
  setSendPromptError: Dispatch<SetStateAction<string | undefined>>;
  setTurnReview: Dispatch<SetStateAction<ChatTurnReview | null>>;
  setPendingApproval: Dispatch<SetStateAction<PendingSessionApproval>>;
  setRunInFlight: Dispatch<SetStateAction<boolean>>;
  setCreatingSession: Dispatch<SetStateAction<boolean>>;
  setSessionNotice: Dispatch<SetStateAction<string | undefined>>;
  liveMessages: LiveSessionMessageActions;
}) {
  const resolveApproval = useCallback(async (approved: boolean) => {
    if (!selectedSessionId || !pendingApproval) {
      return;
    }

    try {
      await resolvePendingSessionApproval(
        selectedSessionId,
        approved,
        approved ? 'Approved in web control plane' : 'Denied in web control plane',
      );
      setPendingApproval(null);
      notify?.({
        title: approved ? 'Approval granted' : 'Approval denied',
        body: pendingApproval.tool,
        tone: approved ? 'success' : 'info',
      });
    } catch (error) {
      notify?.({
        title: 'Approval failed',
        body: error instanceof Error ? error.message : String(error),
        tone: 'error',
      });
    }
  }, [notify, pendingApproval, selectedSessionId, setPendingApproval]);

  const createSession = useCallback(async () => {
    setCreatingSession(true);
    setSessionNotice('Creating a new session…');
    try {
      const created = await createChatSession();
      setSelectedSessionId(created.id);
      setSessionDetail(created);
      setSelectedTurnId(undefined);
      setTurnReview(null);
      setPendingApproval(null);
      setRunInFlight(false);
      setSendPromptError(undefined);
      setSessionDetailError(undefined);
      setSessionNotice(`Created ${created.name}. Ready for a fresh prompt.`);
      notify?.({
        title: 'Session created',
        body: `${created.name} is ready for a fresh prompt.`,
        tone: 'success',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSessionNotice(message);
      notify?.({
        title: 'Session creation failed',
        body: message,
        tone: 'error',
      });
    } finally {
      setCreatingSession(false);
    }
  }, [
    notify,
    setCreatingSession,
    setPendingApproval,
    setRunInFlight,
    setSelectedSessionId,
    setSelectedTurnId,
    setSendPromptError,
    setSessionDetail,
    setSessionDetailError,
    setSessionNotice,
    setTurnReview,
  ]);

  const sendPrompt = useCallback(async (prompt: string) => {
    const trimmed = prompt.trim();
    if (!selectedSessionId || !trimmed || sendingPrompt) {
      return;
    }

    setSendingPrompt(true);
    setRunInFlight(true);
    setSendPromptError(undefined);
    liveMessages.appendPendingUserTurn(trimmed);
    try {
      const result = await sendChatSessionPrompt(selectedSessionId, trimmed);
      setSessionDetail(result.session);
      const latestTurnId = result.session?.turns.at(-1)?.id;
      if (latestTurnId) {
        setSelectedTurnId(latestTurnId);
      }
      setRunInFlight(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSendPromptError(message);
      setRunInFlight(false);
      notify?.({
        title: 'Send failed',
        body: message,
        tone: 'error',
      });
    } finally {
      setSendingPrompt(false);
    }
  }, [
    liveMessages,
    notify,
    selectedSessionId,
    sendingPrompt,
    setRunInFlight,
    setSelectedTurnId,
    setSendingPrompt,
    setSendPromptError,
    setSessionDetail,
  ]);

  const continueSession = useCallback(async () => {
    if (!selectedSessionId || sendingPrompt || runInFlight) {
      return;
    }

    setSendingPrompt(true);
    setRunInFlight(true);
    setSendPromptError(undefined);
    liveMessages.upsertLiveStatusMessage('live-run-status', 'Continuing from the current transcript…', { pending: true, streaming: true });

    try {
      const result = await continueChatSession(selectedSessionId);
      setSessionDetail(result.session);
      const latestTurnId = result.session?.turns.at(-1)?.id;
      if (latestTurnId) {
        setSelectedTurnId(latestTurnId);
      }
      setPendingApproval(await fetchPendingSessionApproval(selectedSessionId));
      setRunInFlight(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSendPromptError(message);
      setRunInFlight(false);
      notify?.({
        title: 'Continue failed',
        body: message,
        tone: 'error',
      });
      liveMessages.removeLiveStatusMessage('live-run-status');
      setSessionDetail((current) => {
        if (!current) {
          return current;
        }
        return {
          ...current,
          messages: current.messages.filter((message) => message.id !== 'live-assistant'),
        };
      });
    } finally {
      setSendingPrompt(false);
    }
  }, [
    liveMessages,
    notify,
    runInFlight,
    selectedSessionId,
    sendingPrompt,
    setPendingApproval,
    setRunInFlight,
    setSelectedTurnId,
    setSendingPrompt,
    setSendPromptError,
    setSessionDetail,
  ]);

  const cancelSessionRun = useCallback(async () => {
    if (!selectedSessionId || !runInFlight) {
      return;
    }

    try {
      const result = await cancelChatSession(selectedSessionId);
      setRunInFlight(false);
      setPendingApproval(null);
      liveMessages.removeLiveStatusMessage('live-run-status');
      setSendPromptError(undefined);
      setSessionDetail((current) => {
        if (!current) {
          return current;
        }
        return {
          ...current,
          messages: current.messages.filter((message) => message.id !== 'live-user' && message.id !== 'live-assistant'),
        };
      });
      notify?.({
        title: result.cancelled ? 'Run cancelled' : 'No active run to cancel',
        body: result.cancelled ? 'The active session run was interrupted.' : undefined,
        tone: result.cancelled ? 'success' : 'info',
      });
    } catch (error) {
      notify?.({
        title: 'Cancel failed',
        body: error instanceof Error ? error.message : String(error),
        tone: 'error',
      });
    }
  }, [
    liveMessages,
    notify,
    runInFlight,
    selectedSessionId,
    setPendingApproval,
    setRunInFlight,
    setSendPromptError,
    setSessionDetail,
  ]);

  const updateSessionSettings = useCallback(async (settings: { model?: string; driftEnabled?: boolean }) => {
    if (!selectedSessionId || runInFlight || sendingPrompt) {
      return;
    }

    try {
      const updated = await updateChatSessionSettings(selectedSessionId, settings);
      setSessionDetail(updated);
      notify?.({
        title: 'Session settings updated',
        body: [
          settings.model ? `model ${settings.model}` : undefined,
          typeof settings.driftEnabled === 'boolean' ? `drift ${settings.driftEnabled ? 'on' : 'off'}` : undefined,
        ].filter(Boolean).join(', '),
        tone: 'success',
      });
    } catch (error) {
      notify?.({
        title: 'Settings update failed',
        body: error instanceof Error ? error.message : String(error),
        tone: 'error',
      });
    }
  }, [notify, runInFlight, selectedSessionId, sendingPrompt, setSessionDetail]);

  return {
    resolveApproval,
    createSession,
    sendPrompt,
    continueSession,
    cancelSessionRun,
    updateSessionSettings,
  };
}
