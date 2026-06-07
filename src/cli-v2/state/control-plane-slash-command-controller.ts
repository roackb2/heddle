import { ClientSharedSessionActivityService } from '@/client-shared/services/session-activities/index.js';
import type { ControlPlaneSlashCommandResult } from '@/client-shared/api/types.js';
import type { ControlPlaneSessionApiService } from '../services/sessions/control-plane-session-api-service.js';
import type { ControlPlaneSessionLoader } from './control-plane-session-loader.js';
import type { ControlPlaneSessionState } from './control-plane-session-state.js';

type ControlPlaneSlashCommandControllerOptions = {
  api: ControlPlaneSessionApiService;
  state: ControlPlaneSessionState;
  loader: ControlPlaneSessionLoader;
  formatError: (error: unknown) => string;
};

/**
 * Owns cli-v2 slash command execution workflow.
 *
 * Core/control-plane owns command modules, parsing, aliases, and result
 * semantics. This controller owns only TUI orchestration after the API returns:
 * command-result retention, session switching, refresh ordering, and follow-on
 * continue/execute actions.
 */
export class ControlPlaneSlashCommandController {
  constructor(private readonly options: ControlPlaneSlashCommandControllerOptions) {}

  async execute(command: string): Promise<void> {
    if (this.options.state.getSnapshot().running) {
      this.options.state.patch({
        commandResults: this.appendCommandResult({
          handled: true,
          kind: 'message',
          message: 'A run is already in progress. Wait for it to finish before running a slash command.',
        }),
        commandResultExpanded: true,
      });
      return;
    }

    const workspaceId = this.options.state.requireWorkspaceId();
    const sessionId = this.options.state.requireActiveSessionId();
    this.options.state.patch({ submitting: true, error: undefined });

    try {
      const result = await this.options.api.executeSlashCommand({ workspaceId, sessionId, command });
      await this.applyResult(workspaceId, result);
    } catch (error) {
      const message = this.formatSlashCommandError(command, error);
      this.options.state.patch({
        error: message,
        commandResults: this.appendCommandResult({
          handled: true,
          kind: 'message',
          message,
        }),
        commandResultExpanded: true,
      });
    } finally {
      this.options.state.patch({ submitting: false });
    }
  }

  private async applyResult(workspaceId: string, result: ControlPlaneSlashCommandResult): Promise<void> {
    if (result.handled === false) {
      return;
    }

    this.options.state.patch({
      commandResults: this.appendCommandResult(result),
      commandResultExpanded: true,
    });

    const resultSessionId = 'sessionId' in result ? result.sessionId : undefined;
    const activeSessionId = this.options.state.getSnapshot().activeSessionId;
    if (resultSessionId && resultSessionId !== activeSessionId) {
      await this.options.loader.refreshSessions();
      await this.options.loader.selectSession(resultSessionId);
    } else if (activeSessionId) {
      const sessions = await this.options.loader.refreshSessions();
      if (sessions.some((session) => session.id === activeSessionId)) {
        await this.options.loader.refreshSession(activeSessionId, { silent: true });
      } else {
        await this.options.loader.selectSession(sessions[0]?.id ?? (await this.options.loader.createSession()).id);
      }
    }

    if (result.kind === 'continue') {
      const sessionId = resultSessionId ?? this.options.state.requireActiveSessionId();
      await this.continueSession(workspaceId, sessionId);
      return;
    }

    if (result.kind === 'execute') {
      await this.submitAgentPrompt(result.prompt);
    }
  }

  private async continueSession(workspaceId: string, sessionId: string): Promise<void> {
    this.options.state.patch({
      running: true,
      commandResultExpanded: false,
      activePlan: undefined,
      currentActivity: ClientSharedSessionActivityService.createThinkingStatus(),
      liveStatus: 'Heddle is continuing from the current transcript...',
    });
    await this.options.api.continueSession(workspaceId, sessionId);
    await this.options.loader.refreshSession(sessionId, { silent: true });
    await this.options.loader.refreshSessions();
  }

  private async submitAgentPrompt(prompt: string): Promise<void> {
    const workspaceId = this.options.state.requireWorkspaceId();
    const sessionId = this.options.state.requireActiveSessionId();
    await this.options.api.sendPromptAsync({ workspaceId, sessionId, prompt });
    this.options.state.patch({
      running: true,
      commandResultExpanded: false,
      activePlan: undefined,
      currentActivity: ClientSharedSessionActivityService.createThinkingStatus(),
      liveStatus: this.options.state.getSnapshot().streamConnected
        ? 'Heddle is working...'
        : 'Heddle is working... reconnecting live stream if needed.',
    });
    await this.options.loader.refreshSession(sessionId, { silent: true });
    await this.options.loader.refreshSessions();
  }

  private appendCommandResult(result: ControlPlaneSlashCommandResult): ControlPlaneSlashCommandResult[] {
    return [...this.options.state.getSnapshot().commandResults, result].slice(-5);
  }

  private formatSlashCommandError(command: string, error: unknown): string {
    const message = this.options.formatError(error);
    if (!message.includes('timed out')) {
      return `Slash command "${command}" failed. ${message}`;
    }

    return [
      `Slash command "${command}" timed out waiting for the control plane.`,
      message,
      'Server-side work may still finish; watch the activity/status line for follow-up updates.',
    ].join(' ');
  }
}
