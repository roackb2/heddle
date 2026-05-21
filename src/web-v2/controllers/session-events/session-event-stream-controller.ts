import type { ControlPlaneSessionEventEnvelope } from './types';

/**
 * Browser-side controller for the control-plane session SSE stream. It keeps
 * EventSource parsing outside React hooks so hooks only handle state updates.
 */
export class SessionEventStreamController {
  static subscribe(
    sessionId: string,
    onUpdate: (event: ControlPlaneSessionEventEnvelope) => void,
    onConnectionChange?: (connected: boolean) => void,
  ): () => void {
    const source = new EventSource(`/control-plane/sessions/${encodeURIComponent(sessionId)}/events`);
    const handle = (type: string) => (event: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(event.data) as Pick<ControlPlaneSessionEventEnvelope, 'sessionId' | 'timestamp' | 'activities'>;
        onUpdate({
          type,
          sessionId: parsed.sessionId ?? sessionId,
          timestamp: parsed.timestamp,
          activities: parsed.activities,
        });
      } catch {
        onUpdate({ type, sessionId });
      }
    };

    source.onopen = () => {
      onConnectionChange?.(true);
    };
    source.onerror = () => {
      onConnectionChange?.(false);
    };
    source.addEventListener('ready', handle('ready'));
    source.addEventListener('waiting', handle('waiting'));
    source.addEventListener('heartbeat', handle('heartbeat'));
    source.addEventListener('session.updated', handle('session.updated'));
    source.addEventListener('session.event', handle('session.event'));

    return () => {
      onConnectionChange?.(false);
      source.close();
    };
  }
}
