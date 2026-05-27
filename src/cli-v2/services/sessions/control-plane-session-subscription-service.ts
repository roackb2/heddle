import type { ControlPlaneProxyClient } from '@/client-shared/api/proxy.js';
import type {
  ControlPlaneSessionEventEnvelope,
  ControlPlaneSessionsEventEnvelope,
} from '@/client-shared/api/types.js';

type SubscriptionHandle = {
  unsubscribe: () => void;
};

export type ControlPlaneSessionSubscriptionServiceOptions = {
  client: ControlPlaneProxyClient;
  onSessionsUpdated: () => void;
  onSessionEvent: (workspaceId: string, event: ControlPlaneSessionEventEnvelope) => void;
  onSessionListError: (error: Error) => void;
  onSessionStreamError: (error: Error) => void;
  onSessionStreamStarted: () => void;
  onSessionStreamComplete: () => void;
};

/**
 * Owns cli-v2 control-plane subscription handles and address deduping.
 */
export class ControlPlaneSessionSubscriptionService {
  private sessionsSubscription?: SubscriptionHandle;
  private sessionSubscription?: SubscriptionHandle;
  private sessionAddress?: { workspaceId: string; sessionId: string };

  constructor(private readonly options: ControlPlaneSessionSubscriptionServiceOptions) {}

  subscribeToSessionList(workspaceId: string): void {
    this.sessionsSubscription?.unsubscribe();
    this.sessionsSubscription = this.options.client.controlPlane.sessionsEvents.subscribe({ workspaceId }, {
      onData: (event: ControlPlaneSessionsEventEnvelope) => {
        if (event.type === 'sessions.updated') {
          this.options.onSessionsUpdated();
        }
      },
      onError: this.options.onSessionListError,
    });
  }

  subscribeToSessionEvents(workspaceId: string, sessionId: string): void {
    if (
      this.sessionAddress?.workspaceId === workspaceId &&
      this.sessionAddress.sessionId === sessionId
    ) {
      return;
    }

    this.sessionSubscription?.unsubscribe();
    this.sessionAddress = { workspaceId, sessionId };
    this.sessionSubscription = this.options.client.controlPlane.sessionEvents.subscribe({ workspaceId, sessionId }, {
      onStarted: this.options.onSessionStreamStarted,
      onData: (event: ControlPlaneSessionEventEnvelope) => {
        this.options.onSessionEvent(workspaceId, event);
      },
      onError: this.options.onSessionStreamError,
      onComplete: this.options.onSessionStreamComplete,
    });
  }

  dispose(): void {
    this.sessionsSubscription?.unsubscribe();
    this.sessionSubscription?.unsubscribe();
    this.sessionsSubscription = undefined;
    this.sessionSubscription = undefined;
    this.sessionAddress = undefined;
  }
}
