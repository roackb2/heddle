export type ControlPlaneSessionEventEnvelope = {
  type: string;
  sessionId: string;
  timestamp?: string;
  event?: unknown;
};

export type LiveSessionEvent = {
  type?: string;
  text?: string;
  done?: boolean;
  tool?: string;
  step?: number;
  durationMs?: number;
  event?: {
    type?: string;
    summary?: string;
    outcome?: string;
    call?: {
      tool?: string;
    };
  };
  status?: 'running' | 'finished' | 'failed';
  archivePath?: string;
  summaryPath?: string;
  error?: string;
};

export type SessionLiveEventViewUpdate = {
  assistantText?: string;
  assistantDone?: boolean;
  status?: string | null;
  running?: boolean;
  refresh?: boolean;
};
