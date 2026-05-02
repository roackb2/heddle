import { useEffect, useMemo, type Dispatch, type SetStateAction } from 'react';
import {
  fetchChatTurnReview,
  type ChatSessionDetail,
  type ChatTurnReview,
} from '../../../../lib/api';

export function useSessionTurnReview({
  sessionDetail,
  selectedTurnId,
  setSelectedTurnId,
  turnReview,
  setTurnReview,
  turnReviewLoading,
  setTurnReviewLoading,
  turnReviewError,
  setTurnReviewError,
}: {
  sessionDetail: ChatSessionDetail | null;
  selectedTurnId?: string;
  setSelectedTurnId: Dispatch<SetStateAction<string | undefined>>;
  turnReview: ChatTurnReview | null;
  setTurnReview: Dispatch<SetStateAction<ChatTurnReview | null>>;
  turnReviewLoading: boolean;
  setTurnReviewLoading: Dispatch<SetStateAction<boolean>>;
  turnReviewError?: string;
  setTurnReviewError: Dispatch<SetStateAction<string | undefined>>;
}) {
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
  }, [selectedTurnId, sessionDetail, setSelectedTurnId]);

  const selectedTurn = useMemo(
    () => sessionDetail?.turns.find((turn) => turn.id === selectedTurnId) ?? sessionDetail?.turns.at(-1),
    [selectedTurnId, sessionDetail],
  );

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
  }, [selectedTurnId, sessionDetail?.id, selectedTurn?.traceFile, setTurnReview, setTurnReviewError, setTurnReviewLoading]);

  return {
    selectedTurn,
    turnReview,
    turnReviewLoading,
    turnReviewError,
  };
}
