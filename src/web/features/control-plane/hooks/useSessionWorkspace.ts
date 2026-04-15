import { useEffect, useMemo, useState } from 'react';
import {
  fetchChatSessionDetail,
  fetchChatTurnReview,
  type ChatSessionDetail,
  type ChatTurnReview,
  type ControlPlaneState,
} from '../../../lib/api';

export type InspectorTab = 'summary' | 'review';
export type SessionDetailValue = Exclude<ChatSessionDetail, null>;
export type SessionTurn = SessionDetailValue['turns'][number];

export type SessionWorkspaceState = {
  activeSession?: ControlPlaneState['sessions'][number];
  selectedSessionId?: string;
  setSelectedSessionId: (sessionId: string) => void;
  sessionDetail: ChatSessionDetail | null;
  sessionDetailLoading: boolean;
  sessionDetailError?: string;
  selectedTurnId?: string;
  setSelectedTurnId: (turnId: string) => void;
  selectedTurn?: SessionTurn;
  turnReview: ChatTurnReview | null;
  turnReviewLoading: boolean;
  turnReviewError?: string;
  inspectorTab: InspectorTab;
  setInspectorTab: (tab: InspectorTab) => void;
};

export function useSessionWorkspace(sessions: ControlPlaneState['sessions'] | undefined): SessionWorkspaceState {
  const [selectedSessionId, setSelectedSessionId] = useState<string | undefined>();
  const [selectedTurnId, setSelectedTurnId] = useState<string | undefined>();
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('review');
  const [sessionDetail, setSessionDetail] = useState<ChatSessionDetail | null>(null);
  const [sessionDetailLoading, setSessionDetailLoading] = useState(false);
  const [sessionDetailError, setSessionDetailError] = useState<string | undefined>();
  const [turnReview, setTurnReview] = useState<ChatTurnReview | null>(null);
  const [turnReviewLoading, setTurnReviewLoading] = useState(false);
  const [turnReviewError, setTurnReviewError] = useState<string | undefined>();

  useEffect(() => {
    if (!sessions?.length) {
      setSelectedSessionId(undefined);
      return;
    }
    if (!selectedSessionId || !sessions.some((session) => session.id === selectedSessionId)) {
      setSelectedSessionId(sessions[0].id);
    }
  }, [selectedSessionId, sessions]);

  useEffect(() => {
    if (!selectedSessionId) {
      setSessionDetail(null);
      setSessionDetailError(undefined);
      return;
    }

    const sessionId = selectedSessionId;
    let cancelled = false;
    setSessionDetailLoading(true);

    async function refresh() {
      try {
        const next = await fetchChatSessionDetail(sessionId);
        if (!cancelled) {
          setSessionDetail(next);
          setSessionDetailError(undefined);
        }
      } catch (refreshError) {
        if (!cancelled) {
          setSessionDetailError(refreshError instanceof Error ? refreshError.message : String(refreshError));
        }
      } finally {
        if (!cancelled) {
          setSessionDetailLoading(false);
        }
      }
    }

    void refresh();

    return () => {
      cancelled = true;
    };
  }, [selectedSessionId, sessions]);

  useEffect(() => {
    const latestTurnId = sessionDetail?.turns.at(-1)?.id;
    if (!sessionDetail) {
      setSelectedTurnId(undefined);
      return;
    }
    if (!latestTurnId) {
      setSelectedTurnId(undefined);
      return;
    }
    if (!selectedTurnId || !sessionDetail.turns.some((turn) => turn.id === selectedTurnId)) {
      setSelectedTurnId(latestTurnId);
    }
  }, [selectedTurnId, sessionDetail]);

  useEffect(() => {
    if (!sessionDetail?.id || !selectedTurnId) {
      setTurnReview(null);
      setTurnReviewError(undefined);
      return;
    }

    const sessionId = sessionDetail.id;
    const turnId = selectedTurnId;
    let cancelled = false;
    setTurnReviewLoading(true);

    async function refresh() {
      try {
        const next = await fetchChatTurnReview(sessionId, turnId);
        if (!cancelled) {
          setTurnReview(next);
          setTurnReviewError(undefined);
        }
      } catch (refreshError) {
        if (!cancelled) {
          setTurnReviewError(refreshError instanceof Error ? refreshError.message : String(refreshError));
        }
      } finally {
        if (!cancelled) {
          setTurnReviewLoading(false);
        }
      }
    }

    void refresh();

    return () => {
      cancelled = true;
    };
  }, [selectedTurnId, sessionDetail?.id, sessionDetail?.turns]);

  const activeSession = useMemo(
    () => sessions?.find((session) => session.id === selectedSessionId),
    [selectedSessionId, sessions],
  );
  const selectedTurn = useMemo(
    () => sessionDetail?.turns.find((turn) => turn.id === selectedTurnId) ?? sessionDetail?.turns.at(-1),
    [selectedTurnId, sessionDetail],
  );

  return {
    activeSession,
    selectedSessionId,
    setSelectedSessionId,
    sessionDetail,
    sessionDetailLoading,
    sessionDetailError,
    selectedTurnId,
    setSelectedTurnId,
    selectedTurn,
    turnReview,
    turnReviewLoading,
    turnReviewError,
    inspectorTab,
    setInspectorTab,
  };
}
