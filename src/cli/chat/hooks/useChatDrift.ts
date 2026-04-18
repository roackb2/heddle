import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CyberLoopDriftLevel, CyberLoopObserverAnnotation } from '../../../index.js';
import type { ChatSession } from '../state/types.js';
import { driftFooterColor, formatDriftFooter } from '../utils/drift-footer.js';

type ActiveSessionUpdater = (updater: (session: ChatSession) => ChatSession) => void;

export function useChatDrift({
  activeSession,
  updateActiveSession,
}: {
  activeSession?: ChatSession;
  updateActiveSession: ActiveSessionUpdater;
}) {
  const [enabled, setEnabledState] = useState(true);
  const [level, setLevel] = useState<CyberLoopDriftLevel>('unknown');
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (!activeSession) {
      return;
    }

    const sessionEnabled = activeSession.driftEnabled ?? true;
    if (sessionEnabled !== enabled) {
      setEnabledState(sessionEnabled);
    }
  }, [activeSession, enabled]);

  const setEnabled = useCallback((nextEnabled: boolean) => {
    setEnabledState(nextEnabled);
    setError(undefined);
    updateActiveSession((session) => ({
      ...session,
      driftEnabled: nextEnabled,
    }));
  }, [updateActiveSession]);

  const observer = useMemo(() => ({
    enabled,
    onRunStart: () => {
      setLevel('unknown');
      setError(undefined);
    },
    onAnnotation: (annotation: CyberLoopObserverAnnotation) => setLevel(annotation.driftLevel),
    onError: (caught: unknown) => setError(caught instanceof Error ? caught.message : String(caught)),
  }), [enabled]);

  return {
    enabled,
    level,
    error,
    setEnabled,
    observer,
    footer: formatDriftFooter(enabled, level, error),
    color: driftFooterColor(enabled, level, error),
  };
}
