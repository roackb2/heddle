import { ClientSharedSessionMessageService } from '@/client-shared/services/session-messages/index.js';
import type {
  ControlPlaneSessionView,
} from '@/client-shared/api/types.js';
import type {
  ControlPlaneSessionApiService,
  ControlPlaneSessionCreateInput,
} from '../services/sessions/control-plane-session-api-service.js';
import type { ControlPlaneSessionSubscriptionService } from '../services/sessions/control-plane-session-subscription-service.js';
import type { AssistantStreamBufferService } from '../services/sessions/assistant-stream-buffer-service.js';
import type { ControlPlaneSessionState } from './control-plane-session-state.js';

type ControlPlaneSessionLoaderOptions = {
  api: ControlPlaneSessionApiService;
  state: ControlPlaneSessionState;
  subscriptions: ControlPlaneSessionSubscriptionService;
  assistantStreamBuffer: AssistantStreamBufferService;
  onRefreshPendingApproval: (sessionId: string) => Promise<void>;
  onError: (error: unknown) => string;
};

/**
 * Owns cli-v2 workspace/session loading and selection lifecycle.
 *
 * This is not a generic API proxy: it owns the ordering that makes a selected
 * session coherent for the TUI, including active-state reset, session detail
 * fetch, runtime context fetch, run-state mirror, pending approval refresh, and
 * event-stream subscription.
 */
export class ControlPlaneSessionLoader {
  constructor(private readonly options: ControlPlaneSessionLoaderOptions) {}

  async refreshSessions(): Promise<ControlPlaneSessionView[]> {
    const workspaceId = this.options.state.requireWorkspaceId();
    const sessions = await this.options.api.listSessions(workspaceId);
    this.options.state.patch({ sessions });
    return sessions;
  }

  async createSession(input: ControlPlaneSessionCreateInput = {}): Promise<ControlPlaneSessionView> {
    const workspaceId = this.options.state.requireWorkspaceId();
    const session = await this.options.api.createSession(workspaceId, input);
    await this.refreshSessions();
    return session;
  }

  async selectSession(sessionId: string): Promise<void> {
    const workspaceId = this.options.state.requireWorkspaceId();
    this.options.assistantStreamBuffer.reset();
    this.options.state.patch({
      activeSessionId: sessionId,
      activeSession: null,
      runtimeContext: undefined,
      pendingApproval: null,
      pendingDirectShellConfirmation: undefined,
      liveStatus: undefined,
      currentActivity: undefined,
      activePlan: undefined,
      recentEditDiffs: [],
      latestUpdate: undefined,
      error: undefined,
      loading: true,
      streamConnected: false,
    });

    try {
      const session = await this.options.api.getSession(workspaceId, sessionId);
      const runtimeContext = await this.options.api.getRuntimeContext(workspaceId, sessionId);
      const running = await this.options.api.getRunning(workspaceId, sessionId);
      this.options.state.patch({
        activeSession: session,
        runtimeContext,
        running: running.running,
        loading: false,
      });
      await this.options.onRefreshPendingApproval(sessionId);
      this.options.subscriptions.subscribeToSessionEvents(workspaceId, sessionId);
    } catch (error) {
      this.options.state.patch({ error: this.options.onError(error), loading: false });
    }
  }

  async refreshSession(sessionId: string, options: { silent?: boolean } = {}): Promise<void> {
    const workspaceId = this.options.state.requireWorkspaceId();
    if (!options.silent) {
      this.options.state.patch({ loading: true });
    }

    try {
      const next = await this.options.api.getSession(workspaceId, sessionId);
      const runtimeContext = await this.options.api.getRuntimeContext(workspaceId, sessionId);
      this.options.state.patch((current) => ({
        activeSession: options.silent
          ? ClientSharedSessionMessageService.mergeTransientMessages(current.activeSession, next)
          : next,
        runtimeContext,
        loading: false,
      }));
    } catch (error) {
      this.options.state.patch({ error: this.options.onError(error), loading: false });
    }
  }

}
