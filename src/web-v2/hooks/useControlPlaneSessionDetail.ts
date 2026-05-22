import { useMemo, useState } from 'react';
import type { ControlPlaneSessionDetail } from '@web/api/client';
import { useControlPlaneSessionEvents } from './useControlPlaneSessionEvents';
import { useControlPlaneSessionLoader } from './useControlPlaneSessionLoader';
import { useControlPlaneSessionPromptSubmit } from './useControlPlaneSessionPromptSubmit';

export type { ControlPlaneSessionDetail } from '@web/api/client';

type ControlPlaneSessionDetailState = {
  session: ControlPlaneSessionDetail;
  loading: boolean;
  submitting: boolean;
  running: boolean;
  error?: string;
  liveStatus?: string;
  submitPrompt: (prompt: string) => Promise<void>;
};

// Composes the web-v2 session detail workflow from focused hooks: persisted
// detail loading, live event subscription, and prompt submission.
export function useControlPlaneSessionDetail(sessionId: string | undefined): ControlPlaneSessionDetailState {
  const [running, setRunning] = useState(false);
  const [liveStatus, setLiveStatus] = useState<string | undefined>();
  const loader = useControlPlaneSessionLoader(sessionId);
  const events = useControlPlaneSessionEvents({
    sessionId,
    refresh: loader.refresh,
    setSession: loader.setSession,
    setRunning,
    setLiveStatus,
  });
  const promptSubmit = useControlPlaneSessionPromptSubmit({
    sessionId,
    streamConnected: events.streamConnected,
    setSession: loader.setSession,
    setRunning,
    setError: loader.setError,
    setLiveStatus,
  });

  return useMemo(() => ({
    session: loader.session,
    loading: loader.loading,
    submitting: promptSubmit.submitting,
    running,
    error: loader.error,
    liveStatus,
    submitPrompt: promptSubmit.submitPrompt,
  }), [
    liveStatus,
    loader.error,
    loader.loading,
    loader.session,
    promptSubmit.submitting,
    promptSubmit.submitPrompt,
    running,
  ]);
}
