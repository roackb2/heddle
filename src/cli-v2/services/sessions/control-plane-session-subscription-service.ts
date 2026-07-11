import type { ControlPlaneProxyClient } from '@/client-shared/api/proxy.js';
import type {
  ControlPlaneSessionEventEnvelope,
  ControlPlaneSessionRunEventEnvelope,
  ControlPlaneSessionsEventEnvelope,
} from '@/client-shared/api/types.js';
import {
  ClientSharedConversationRunStreamService,
  type ClientSharedConversationRunReference,
} from '@/client-shared/services/conversation-run-stream/index.js';

type SubscriptionHandle = {
  unsubscribe: () => void;
};

export type ControlPlaneSessionSubscriptionServiceOptions = {
  client: ControlPlaneProxyClient;
  onSessionsUpdated: () => void;
  onSessionEvent: (workspaceId: string, event: ControlPlaneSessionEventEnvelope) => void;
  onRunEvent: (workspaceId: string, sessionId: string, event: ControlPlaneSessionRunEventEnvelope) => void;
  onSessionListError: (error: Error) => void;
  onSessionStreamError: (error: Error) => void;
  onSessionStreamStarted: () => void;
  onSessionStreamComplete: () => void;
  onRunStreamError: (error: Error) => void;
  onRunStreamStarted: () => void;
  onRunStreamReconnecting: (input: { attempt: number; delayMs: number; error: Error }) => void;
  onRunStreamComplete: () => void;
};

/**
 * Owns cli-v2 control-plane subscription handles and address deduping.
 */
export class ControlPlaneSessionSubscriptionService {
  private sessionsSubscription?: SubscriptionHandle;
  private sessionSubscription?: SubscriptionHandle;
  private runSubscription?: SubscriptionHandle;
  private runReconnectTimer?: ReturnType<typeof setTimeout>;
  private sessionAddress?: { workspaceId: string; sessionId: string };
  private readonly runStream = new ClientSharedConversationRunStreamService();

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
    this.stopRunSubscription();
    this.sessionAddress = { workspaceId, sessionId };
    this.sessionSubscription = this.options.client.controlPlane.sessionEvents.subscribe({ workspaceId, sessionId }, {
      onStarted: this.options.onSessionStreamStarted,
      onData: (event: ControlPlaneSessionEventEnvelope) => {
        if (event.type === 'session.run.updated') {
          this.subscribeToRun({ workspaceId, sessionId, runId: event.run.runId });
        }
        this.options.onSessionEvent(workspaceId, event);
      },
      onError: this.options.onSessionStreamError,
      onComplete: this.options.onSessionStreamComplete,
    });
  }

  subscribeToRun(run: ClientSharedConversationRunReference): void {
    const sessionAddress = this.sessionAddress;
    if (
      !sessionAddress
      || sessionAddress.workspaceId !== run.workspaceId
      || sessionAddress.sessionId !== run.sessionId
    ) {
      return;
    }

    const changed = this.runStream.select(run);
    if (changed) {
      this.stopRunTransport();
    }
    if (!this.runSubscription && !this.runReconnectTimer) {
      this.connectRunStream();
    }
  }

  dispose(): void {
    this.sessionsSubscription?.unsubscribe();
    this.sessionSubscription?.unsubscribe();
    this.stopRunSubscription();
    this.sessionsSubscription = undefined;
    this.sessionSubscription = undefined;
    this.sessionAddress = undefined;
  }

  private connectRunStream(): void {
    const input = this.runStream.subscriptionInput();
    if (!input) {
      return;
    }

    this.runSubscription = this.options.client.controlPlane.sessionRunEvents.subscribe(input, {
      onStarted: this.options.onRunStreamStarted,
      onData: (event: ControlPlaneSessionRunEventEnvelope) => {
        try {
          const accepted = this.runStream.accept(event);
          if (accepted.accepted) {
            this.options.onRunEvent(input.workspaceId, input.sessionId, event);
          }
        } catch (error) {
          this.scheduleRunReconnect(asError(error));
        }
      },
      onError: (error) => {
        this.runSubscription = undefined;
        this.scheduleRunReconnect(error);
      },
      onComplete: () => {
        this.runSubscription = undefined;
        this.options.onRunStreamComplete();
        if (!this.runStream.isTerminal()) {
          this.scheduleRunReconnect(new Error('Conversation run stream ended before a terminal item.'));
        }
      },
    });
  }

  private scheduleRunReconnect(error: Error): void {
    if (this.runStream.isTerminal() || this.runReconnectTimer) {
      return;
    }

    this.runSubscription?.unsubscribe();
    this.runSubscription = undefined;
    const retry = this.runStream.nextRetry();
    if (!retry) {
      this.options.onRunStreamError(error);
      return;
    }

    this.options.onRunStreamReconnecting({
      attempt: retry.attempt,
      delayMs: retry.delayMs,
      error,
    });
    this.runReconnectTimer = setTimeout(() => {
      this.runReconnectTimer = undefined;
      this.connectRunStream();
    }, retry.delayMs);
  }

  private stopRunSubscription(): void {
    this.stopRunTransport();
    this.runStream.clear();
  }

  private stopRunTransport(): void {
    this.runSubscription?.unsubscribe();
    this.runSubscription = undefined;
    if (this.runReconnectTimer) {
      clearTimeout(this.runReconnectTimer);
      this.runReconnectTimer = undefined;
    }
  }
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
