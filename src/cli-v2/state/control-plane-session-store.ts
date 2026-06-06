import {
  ControlPlaneSessionApiService,
  type ControlPlaneSessionCreateInput,
} from '../services/sessions/control-plane-session-api-service.js';
import { SlashCommandAutocompleteService } from '../services/slash-commands/index.js';
import { ControlPlaneSessionSubscriptionService } from '../services/sessions/control-plane-session-subscription-service.js';
import {
  AssistantStreamBufferService,
} from '../services/sessions/assistant-stream-buffer-service.js';
import {
  SessionRunStatePollerService,
} from '../services/sessions/session-run-state-poller-service.js';
import {
  ControlPlaneSessionState,
  type ControlPlaneSessionStoreOptions,
  type ControlPlaneSessionStoreSnapshot,
  type ControlPlaneSessionStoreStartInput,
} from './control-plane-session-state.js';
import type {
  ControlPlaneApprovalDecision,
  ControlPlaneSessionView,
  ControlPlaneSlashCommandHint,
  ControlPlaneWorkspaceFileSuggestion,
} from '@/client-shared/api/types.js';
import { ControlPlaneSessionLoader } from './control-plane-session-loader.js';
import { ControlPlaneDirectShellController } from './control-plane-direct-shell-controller.js';
import { ControlPlaneSlashCommandController } from './control-plane-slash-command-controller.js';
import { ControlPlanePromptController } from './control-plane-prompt-controller.js';
import { ControlPlaneLiveEventReducer } from './control-plane-live-event-reducer.js';
import { ControlPlaneApprovalController } from './control-plane-approval-controller.js';
import { ControlPlaneRunController } from './control-plane-run-controller.js';

const ASSISTANT_STREAM_RENDER_INTERVAL_MS = 75;
const RUN_STATE_POLL_INTERVAL_MS = 750;

export type {
  ControlPlaneSessionStoreOptions,
  ControlPlaneSessionStoreSnapshot,
  ControlPlaneSessionStoreStartInput,
} from './control-plane-session-state.js';

/**
 * Public facade for cli-v2 control-plane session state over the shared tRPC API.
 *
 * Keep this class thin by composition: workflow controllers own lifecycle and
 * state-transition behavior, while this facade preserves the stable API that
 * Ink components call. Shared activity/prompt policy stays in client-shared;
 * core/control-plane remains the source of truth for domain behavior.
 */
export class ControlPlaneSessionStore {
  private readonly api: ControlPlaneSessionApiService;
  private readonly state: ControlPlaneSessionState;
  private readonly subscriptions: ControlPlaneSessionSubscriptionService;
  private readonly assistantStreamBuffer: AssistantStreamBufferService;
  private readonly runStatePoller: SessionRunStatePollerService;
  private readonly loader: ControlPlaneSessionLoader;
  private readonly directShell: ControlPlaneDirectShellController;
  private readonly slashCommands: ControlPlaneSlashCommandController;
  private readonly prompts: ControlPlanePromptController;
  private readonly liveEvents: ControlPlaneLiveEventReducer;
  private readonly approvals: ControlPlaneApprovalController;
  private readonly runs: ControlPlaneRunController;

  constructor(options: ControlPlaneSessionStoreOptions) {
    this.api = new ControlPlaneSessionApiService(options);
    this.state = new ControlPlaneSessionState(() => this.runStatePoller.sync());
    this.subscriptions = new ControlPlaneSessionSubscriptionService({
      client: options.client,
      onSessionsUpdated: () => {
        void this.refreshSessions().catch((error) => this.state.patch({ error: formatError(error) }));
      },
      onSessionEvent: (workspaceId, event) => this.liveEvents.applySessionEvent(workspaceId, event),
      onSessionListError: (error) => this.state.patch({ error: error.message }),
      onSessionStreamError: (error) => {
        this.state.patch({ streamConnected: false, liveStatus: error.message });
      },
      onSessionStreamStarted: () => {
        this.state.patch({ streamConnected: true });
      },
      onSessionStreamComplete: () => {
        this.state.patch({ streamConnected: false });
      },
    });
    this.assistantStreamBuffer = new AssistantStreamBufferService({
      renderIntervalMs: ASSISTANT_STREAM_RENDER_INTERVAL_MS,
      canApply: (update) => (
        this.state.isActiveSessionAddress(update.workspaceId, update.sessionId) &&
        (this.state.getSnapshot().running || this.state.getSnapshot().submitting)
      ),
      apply: (update) => this.liveEvents.applyAssistantStreamUpdate(update),
    });
    this.runStatePoller = new SessionRunStatePollerService({
      intervalMs: RUN_STATE_POLL_INTERVAL_MS,
      getAddress: () => this.runs.resolveRunStatePollAddress(),
      isEnabled: () => this.runs.shouldPollRunState(),
      poll: (address) => this.runs.pollRunState(address),
      onError: (error) => this.state.patch({ error: formatError(error) }),
    });
    this.loader = new ControlPlaneSessionLoader({
      api: this.api,
      state: this.state,
      subscriptions: this.subscriptions,
      assistantStreamBuffer: this.assistantStreamBuffer,
      onRefreshPendingApproval: (sessionId) => this.approvals.refresh(sessionId),
      onError: formatError,
    });
    this.approvals = new ControlPlaneApprovalController({
      api: this.api,
      state: this.state,
      formatError,
    });
    this.liveEvents = new ControlPlaneLiveEventReducer({
      state: this.state,
      loader: this.loader,
      assistantStreamBuffer: this.assistantStreamBuffer,
      refreshSessions: () => this.refreshSessions(),
      refreshPendingApproval: (sessionId) => this.approvals.refresh(sessionId),
    });
    this.directShell = new ControlPlaneDirectShellController({
      api: this.api,
      state: this.state,
      loader: this.loader,
      assistantStreamBuffer: this.assistantStreamBuffer,
      refreshSessions: () => this.refreshSessions(),
      refreshPendingApproval: (sessionId) => this.approvals.refresh(sessionId),
      formatError,
    });
    this.runs = new ControlPlaneRunController({
      api: this.api,
      state: this.state,
      loader: this.loader,
      approvals: this.approvals,
      refreshSessions: () => this.refreshSessions(),
      formatError,
    });
    this.slashCommands = new ControlPlaneSlashCommandController({
      api: this.api,
      state: this.state,
      loader: this.loader,
      formatError,
    });
    this.prompts = new ControlPlanePromptController({
      api: this.api,
      state: this.state,
      loader: this.loader,
      assistantStreamBuffer: this.assistantStreamBuffer,
      slashCommands: this.slashCommands,
      directShell: this.directShell,
      refreshSessions: () => this.refreshSessions(),
      refreshPendingApproval: (sessionId) => this.approvals.refresh(sessionId),
      formatError,
    });
  }

  getSnapshot = (): ControlPlaneSessionStoreSnapshot => this.state.getSnapshot();

  subscribe = (listener: () => void): (() => void) => {
    return this.state.subscribe(listener);
  };

  async start(input: ControlPlaneSessionStoreStartInput = {}): Promise<void> {
    this.state.patch({ loading: true, error: undefined });
    try {
      const workspaceId = await this.api.resolveWorkspaceId(input.workspaceId);
      const modelOptions = await this.api.getModelOptions();

      this.state.patch({ workspaceId, modelOptions });
      await this.refreshSlashCommandCatalog(workspaceId);
      this.subscriptions.subscribeToSessionList(workspaceId);
      const sessions = await this.refreshSessions();
      const sessionId = input.sessionId ?? sessions[0]?.id ?? (await this.createSession()).id;
      await this.selectSession(sessionId);
    } catch (error) {
      this.state.patch({ error: formatError(error), loading: false });
    }
  }

  dispose(): void {
    this.subscriptions.dispose();
    this.assistantStreamBuffer.dispose();
    this.runStatePoller.dispose();
  }

  async refreshSessions(): Promise<ControlPlaneSessionView[]> {
    return this.loader.refreshSessions();
  }

  async searchWorkspaceFileMentions(query: string, limit = 20): Promise<ControlPlaneWorkspaceFileSuggestion[]> {
    const workspaceId = this.state.requireWorkspaceId();
    const result = await this.api.searchWorkspaceFiles({ workspaceId, query, limit });
    return result.workspaceId === workspaceId ? result.files : [];
  }

  async createSession(input: ControlPlaneSessionCreateInput = {}): Promise<ControlPlaneSessionView> {
    return this.loader.createSession(input);
  }

  async selectSession(sessionId: string): Promise<void> {
    await this.loader.selectSession(sessionId);
  }

  async submitPrompt(prompt: string): Promise<void> {
    await this.prompts.submitPrompt(prompt);
  }

  getSlashCommandHints(draft: string): ControlPlaneSlashCommandHint[] {
    return SlashCommandAutocompleteService.filterHints(draft, this.state.getSnapshot().slashCommandCatalog?.hints ?? []);
  }

  completeSlashCommandDraft(draft: string): string | undefined {
    return SlashCommandAutocompleteService.complete(draft, this.state.getSnapshot().slashCommandCatalog?.hints ?? []);
  }

  async selectModelFromPicker(modelId: string): Promise<void> {
    await this.slashCommands.execute(`/model ${modelId}`);
  }

  async selectSessionFromPicker(sessionId: string): Promise<void> {
    await this.slashCommands.execute(`/session switch ${sessionId}`);
  }

  async selectReasoningFromPicker(reasoningEffort: string): Promise<void> {
    await this.slashCommands.execute(reasoningEffort === 'default' ? '/reasoning default' : `/reasoning ${reasoningEffort}`);
  }

  async cancelRun(): Promise<void> {
    await this.runs.cancelRun();
  }

  async resolvePendingApproval(decision: ControlPlaneApprovalDecision): Promise<void> {
    await this.approvals.resolve(decision);
  }

  toggleCommandResultExpanded(): void {
    this.state.patch((current) => ({
      commandResultExpanded: current.commandResults.some((result) => result.handled)
        ? !current.commandResultExpanded
        : false,
    }));
  }

  private async refreshSlashCommandCatalog(workspaceId: string): Promise<void> {
    const slashCommandCatalog = await this.api.getSlashCommandCatalog(workspaceId);
    this.state.patch({ slashCommandCatalog });
  }

  async resolveDirectShellConfirmation(accepted: boolean): Promise<void> {
    await this.directShell.resolveConfirmation(accepted);
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
