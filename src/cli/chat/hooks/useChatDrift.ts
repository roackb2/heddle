import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CyberLoopDriftLevel, CyberLoopObserverAnnotation } from '../../../index.js';
import type { ChatSession } from '../state/types.js';
import { driftFooterColor, formatDriftFooter } from '../utils/drift-footer.js';

export function useChatDrift({
  activeSession,
  setSessionDriftEnabled,
}: {
  activeSession?: ChatSession;
  setSessionDriftEnabled: (id: string, enabled: boolean) => Promise<void> | void;
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
    if (!activeSession) {
      return;
    }

    void Promise.resolve(setSessionDriftEnabled(activeSession.id, nextEnabled)).catch((caught: unknown) => {
      setEnabledState(!nextEnabled);
      setError(caught instanceof Error ? caught.message : String(caught));
    });
  }, [activeSession, setSessionDriftEnabled]);

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
