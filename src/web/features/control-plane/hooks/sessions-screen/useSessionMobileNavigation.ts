import { useEffect, useMemo, useState } from 'react';
import { className } from '../../utils';

type MobileView = 'list' | 'chat' | 'review';

export function useSessionMobileNavigation({
  selectedSessionId,
  onSelectSession,
  onSelectTurn,
}: {
  selectedSessionId?: string;
  onSelectSession: (sessionId: string) => void;
  onSelectTurn: (turnId: string) => void;
}) {
  const [mobileView, setMobileView] = useState<MobileView>('list');

  useEffect(() => {
    if (!selectedSessionId) {
      setMobileView('list');
      return;
    }

    setMobileView((current) => current === 'list' ? 'chat' : current);
  }, [selectedSessionId]);

  const shellClassName = useMemo(() => {
    return className('workspace-shell', `mobile-view-${mobileView}`);
  }, [mobileView]);

  const selectSession = (sessionId: string) => {
    onSelectSession(sessionId);
    setMobileView('chat');
  };

  const selectTurn = (turnId: string) => {
    onSelectTurn(turnId);
    setMobileView('review');
  };

  return {
    mobileView,
    shellClassName,
    selectSession,
    selectTurn,
    showSessionList: () => setMobileView('list'),
    showChatView: () => setMobileView('chat'),
    openReviewInspector: () => setMobileView('review'),
  };
}
