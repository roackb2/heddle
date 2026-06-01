import { ClientSharedPromptInputService } from '@/client-shared/services/prompt-input/index.js';
import { ClientSharedSessionActivityService } from '@/client-shared/services/session-activities/index.js';
import type { ControlPlaneSessionApiService } from '../services/sessions/control-plane-session-api-service.js';
import type { AssistantStreamBufferService } from '../services/sessions/assistant-stream-buffer-service.js';
import type { ControlPlaneDirectShellController } from './control-plane-direct-shell-controller.js';
import type { ControlPlaneSessionLoader } from './control-plane-session-loader.js';
import type { ControlPlaneSessionState } from './control-plane-session-state.js';
import type { ControlPlaneSlashCommandController } from './control-plane-slash-command-controller.js';
import { SlashCommandAutocompleteService } from '../services/slash-commands/index.js';

type ControlPlanePromptControllerOptions = {
  api: ControlPlaneSessionApiService;
  state: ControlPlaneSessionState;
  loader: ControlPlaneSessionLoader;
  assistantStreamBuffer: AssistantStreamBufferService;
  slashCommands: ControlPlaneSlashCommandController;
  directShell: ControlPlaneDirectShellController;
  refreshSessions: () => Promise<unknown>;
  refreshPendingApproval: (sessionId: string) => Promise<void>;
  formatError: (error: unknown) => string;
};

/**
 * Owns cli-v2 prompt intent routing and normal prompt submission.
 *
 * Prompt parsing rules stay in client-shared. Slash and direct-shell workflows
 * stay in their controllers. This controller owns the TUI-specific routing
 * between those paths plus normal prompt queue/run-accepted state transitions.
 */
export class ControlPlanePromptController {
  constructor(private readonly options: ControlPlanePromptControllerOptions) {}

  async submitPrompt(prompt: string): Promise<void> {
    const trimmed = prompt.trim();
    if (!trimmed || this.options.state.getSnapshot().submitting) {
      return;
    }

    if (SlashCommandAutocompleteService.isSlashDraft(trimmed)) {
      await this.options.slashCommands.execute(trimmed);
      return;
    }

    const directShell = ClientSharedPromptInputService.parseDirectShellDraft(trimmed);
    if (directShell) {
      await this.options.directShell.submit(directShell.command);
      return;
    }

    await this.submitNormalPrompt(trimmed);
  }

  private async submitNormalPrompt(prompt: string): Promise<void> {
    const workspaceId = this.options.state.requireWorkspaceId();
    const sessionId = this.options.state.requireActiveSessionId();
    this.options.state.patch((current) => ({
      submitting: true,
      running: true,
      error: undefined,
      activePlan: undefined,
      currentActivity: ClientSharedSessionActivityService.createThinkingStatus(),
      liveStatus: current.streamConnected
        ? 'Heddle is working...'
        : 'Heddle is working... reconnecting live stream if needed.',
      latestUpdate: {
        label: 'Thinking',
        detail: 'waiting for model or tool activity',
        tone: 'info',
      },
    }));

    try {
      const result = await this.options.api.sendPromptAsync({
        workspaceId,
        sessionId,
        prompt,
      });
      if ('queued' in result) {
        this.options.state.patch({
          submitting: false,
          running: this.options.state.getSnapshot().running,
          liveStatus: this.options.state.getSnapshot().running
            ? this.options.state.getSnapshot().liveStatus
            : 'Queued prompt will run when earlier work finishes.',
          latestUpdate: {
            label: 'Prompt queued',
            detail: `position ${result.position}`,
            tone: 'info',
          },
        });
        await this.options.loader.refreshSession(sessionId, { silent: true });
        await this.options.refreshSessions();
        return;
      }

      this.options.assistantStreamBuffer.reset();
      this.options.state.patch({
        submitting: false,
        running: true,
        liveStatus: this.options.state.getSnapshot().streamConnected
          ? 'Heddle is working...'
          : 'Heddle is working... reconnecting live stream if needed.',
        currentActivity: this.options.state.getSnapshot().currentActivity
          ?? ClientSharedSessionActivityService.createThinkingStatus(),
        latestUpdate: {
          label: 'Run accepted',
          detail: result.runId,
          tone: 'info',
        },
      });
      await this.options.loader.refreshSession(sessionId, { silent: true });
      await this.options.refreshSessions();
      await this.options.refreshPendingApproval(sessionId);
    } catch (error) {
      if (isRunAlreadyInProgressError(error, this.options.formatError)) {
        this.options.state.patch({
          error: undefined,
          running: true,
          submitting: false,
          liveStatus: this.options.state.getSnapshot().streamConnected
            ? 'A run is already in progress for this session.'
            : 'A run is already in progress for this session. Reconnecting live stream if needed.',
          currentActivity: this.options.state.getSnapshot().currentActivity
            ?? ClientSharedSessionActivityService.createThinkingStatus(),
          latestUpdate: {
            label: 'Run already in progress',
            detail: 'waiting for current run to finish',
            tone: 'warning',
          },
        });
        return;
      }

      this.options.state.patch({
        error: this.options.formatError(error),
        running: false,
        submitting: false,
        liveStatus: undefined,
        currentActivity: undefined,
      });
      await this.options.loader.refreshSession(sessionId, { silent: true }).catch(() => undefined);
      this.options.assistantStreamBuffer.reset();
    }
  }
}

function isRunAlreadyInProgressError(error: unknown, formatError: (error: unknown) => string): boolean {
  return formatError(error).includes('A run is already in progress for this session.');
}
