import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  ChatSessionDetail,
  ChatTurnReview,
  ControlPlaneState,
  PendingSessionApproval,
} from '../../../lib/api';
import type { ToastInput } from '../../../components/ui/use-toast';
import type { SessionsScreenState } from './sessions-screen/sessionStateTypes';
import { useLiveSessionMessages } from './sessions-screen/useLiveSessionMessages';
import { useSessionDetailSubscription } from './sessions-screen/useSessionDetailSubscription';
import { useSessionMutations } from './sessions-screen/useSessionMutations';
import { useSessionTurnReview } from './sessions-screen/useSessionTurnReview';

export type { SessionDetailValue, SessionsScreenState, SessionTurn } from './sessions-screen/sessionStateTypes';

export function useSessionsScreenState(
  sessions: ControlPlaneState['sessions'] | undefined,
  notify?: (toast: ToastInput) => void,
  onSessionsChanged?: () => void,
  options?: {
    selectedSessionId?: string;
    onSelectedSessionIdChange?: (sessionId?: string) => void;
    autoSelectSession?: boolean;
  },
): SessionsScreenState {
  const [internalSelectedSessionId, setInternalSelectedSessionId] = useState<string | undefined>();
  const [selectedTurnId, setSelectedTurnId] = useState<string | undefined>();
  const [sessionDetail, setSessionDetail] = useState<ChatSessionDetail | null>(null);
  const [sessionDetailLoading, setSessionDetailLoading] = useState(false);
  const [sessionDetailError, setSessionDetailError] = useState<string | undefined>();
  const [sendingPrompt, setSendingPrompt] = useState(false);
  const [sendPromptError, setSendPromptError] = useState<string | undefined>();
  const [turnReview, setTurnReview] = useState<ChatTurnReview | null>(null);
  const [turnReviewLoading, setTurnReviewLoading] = useState(false);
  const [turnReviewError, setTurnReviewError] = useState<string | undefined>();
  const [pendingApproval, setPendingApproval] = useState<PendingSessionApproval>(null);
  const [runInFlight, setRunInFlight] = useState(false);
  const [memoryUpdating, setMemoryUpdating] = useState(false);
  const [creatingSession, setCreatingSession] = useState(false);
  const [sessionNotice, setSessionNotice] = useState<string | undefined>();
  const selectedSessionId = options?.selectedSessionId ?? internalSelectedSessionId;
  const setRawSelectedSessionId = options?.onSelectedSessionIdChange ?? setInternalSelectedSessionId;
  const autoSelectSession = options?.autoSelectSession ?? true;
  const liveMessages = useLiveSessionMessages(setSessionDetail);

  useEffect(() => {
    if (!autoSelectSession) {
      return;
    }

    if (!sessions?.length) {
      if (selectedSessionId && sessionDetail?.id === selectedSessionId) {
        return;
      }
      setRawSelectedSessionId(undefined);
      return;
    }

    if (selectedSessionId && sessionDetail?.id === selectedSessionId) {
      return;
    }

    if (!selectedSessionId || !sessions.some((session) => session.id === selectedSessionId)) {
      setRawSelectedSessionId(sessions[0].id);
    }
  }, [autoSelectSession, selectedSessionId, sessionDetail?.id, sessions, setRawSelectedSessionId]);

  const selectSession = useCallback((sessionId: string) => {
    setRawSelectedSessionId(sessionId);
    setSelectedTurnId(undefined);
    setSessionNotice(undefined);
    setSendPromptError(undefined);
  }, [setRawSelectedSessionId]);

  useSessionDetailSubscription({
    selectedSessionId,
    setSessionDetail,
    setSessionDetailLoading,
    setSessionDetailError,
    setRunInFlight,
    setMemoryUpdating,
    setPendingApproval,
    onSessionsChanged,
    liveMessages,
  });

  const activeSession = useMemo(
    () => sessions?.find((session) => session.id === selectedSessionId),
    [selectedSessionId, sessions],
  );

  const {
    selectedTurn,
    turnReview: loadedTurnReview,
    turnReviewLoading: loadedTurnReviewLoading,
    turnReviewError: loadedTurnReviewError,
  } = useSessionTurnReview({
    sessionDetail,
    selectedTurnId,
    setSelectedTurnId,
    turnReview,
    setTurnReview,
    turnReviewLoading,
    setTurnReviewLoading,
    turnReviewError,
    setTurnReviewError,
  });

  const {
    resolveApproval,
    createSession,
    sendPrompt,
    continueSession,
    cancelSessionRun,
    updateSessionSettings,
  } = useSessionMutations({
    selectedSessionId,
    pendingApproval,
    sendingPrompt,
    runInFlight,
    notify,
    setSelectedSessionId: setRawSelectedSessionId,
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
  });

  return {
    activeSession,
    selectedSessionId,
    setSelectedSessionId: selectSession,
    sessionDetail,
    sessionDetailLoading,
    sessionDetailError,
    sendingPrompt,
    runInFlight,
    memoryUpdating,
    sendPromptError,
    sendPrompt,
    creatingSession,
    sessionNotice,
    createSession,
    continueSession,
    cancelSessionRun,
    updateSessionSettings,
    pendingApproval,
    resolveApproval,
    selectedTurnId,
    setSelectedTurnId,
    selectedTurn,
    turnReview: loadedTurnReview,
    turnReviewLoading: loadedTurnReviewLoading,
    turnReviewError: loadedTurnReviewError,
  };
}
