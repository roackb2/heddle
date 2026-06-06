import { ClientSharedSessionActivityService } from '@/client-shared/services/session-activities/index.js';
import { ClientSharedSessionMessageService } from '@/client-shared/services/session-messages/index.js';
import type { ControlPlaneSessionEventEnvelope } from '@/client-shared/api/types.js';
import { SessionActivityService } from '../services/activities/session-activity-service.js';
import type { AssistantStreamBufferService, AssistantStreamUpdate } from '../services/sessions/assistant-stream-buffer-service.js';
import type { ControlPlaneSessionLoader } from './control-plane-session-loader.js';
import type { ControlPlaneSessionState } from './control-plane-session-state.js';

type ControlPlaneLiveEventReducerOptions = {
  state: ControlPlaneSessionState;
  loader: ControlPlaneSessionLoader;
  assistantStreamBuffer: AssistantStreamBufferService;
  refreshSessions: () => Promise<unknown>;
  refreshPendingApproval: (sessionId: string) => Promise<void>;
};

const MAX_RECENT_EDIT_DIFFS = 5;

/**
 * Owns cli-v2 reduction of control-plane live events into render state.
 *
 * Server events are the transport contract. Client-shared owns activity
 * semantics. This reducer owns only terminal snapshot effects: streaming text,
 * current activity, plan visibility, pending approval refresh triggers, and
 * latest-update state.
 */
export class ControlPlaneLiveEventReducer {
  constructor(private readonly options: ControlPlaneLiveEventReducerOptions) {}

  applySessionEvent(workspaceId: string, event: ControlPlaneSessionEventEnvelope): void {
    if (!this.options.state.isActiveSessionAddress(workspaceId, event.sessionId)) {
      return;
    }

    if (event.type === 'waiting') {
      this.options.state.patch({
        liveStatus: 'Waiting for the session event stream...',
        latestUpdate: {
          label: 'Waiting for session events',
          tone: 'info',
        },
      });
      return;
    }

    if (event.type === 'session.updated' || event.type === 'session.queue.updated') {
      void this.options.loader.refreshSession(event.sessionId, { silent: true });
      return;
    }

    if (event.type === 'session.approval.updated') {
      void this.options.refreshPendingApproval(event.sessionId);
      return;
    }

    if (event.type !== 'session.event') {
      return;
    }

    event.activities.forEach((activity) => {
      ClientSharedSessionActivityService.applyActivity(activity, {
        onAssistantStream: (streamActivity) => {
          this.options.assistantStreamBuffer.push({
            workspaceId,
            sessionId: event.sessionId,
            text: streamActivity.text,
            done: streamActivity.done,
          });
        },
        onRunStarted: (runActivity, liveStatus) => {
          this.options.state.patch({
            running: true,
            commandResultExpanded: false,
            liveStatus,
            currentActivity: ClientSharedSessionActivityService.createThinkingStatus(runActivity.timestamp),
            recentEditDiffs: [],
            latestUpdate: SessionActivityService.resolveLatestUpdate(runActivity),
          });
        },
        onRecentEditDiff: (diff) => {
          this.options.state.patch((current) => ({
            recentEditDiffs: [
              ...current.recentEditDiffs.filter((candidate) => candidate.id !== diff.id),
              diff,
            ].slice(-MAX_RECENT_EDIT_DIFFS),
          }));
        },
        onRunFinished: (runActivity, liveStatus) => {
          this.options.assistantStreamBuffer.flush();
          this.options.state.patch({
            running: false,
            ...(liveStatus !== undefined ? { liveStatus } : {}),
            currentActivity: undefined,
            latestUpdate: SessionActivityService.resolveLatestUpdate(runActivity),
          });
          void this.options.loader.refreshSession(event.sessionId, { silent: true });
          void this.options.refreshSessions();
        },
        onPendingApprovalChanged: () => {
          void this.options.refreshPendingApproval(event.sessionId);
        },
        onPlanUpdated: (plan) => {
          this.options.state.patch({ activePlan: plan });
        },
        onPlanCleared: () => {
          this.options.state.patch({ activePlan: undefined });
        },
        onCurrentActivityChanged: (currentActivity) => {
          this.options.state.patch({ currentActivity });
        },
        onLiveStatus: (statusActivity, liveStatus) => {
          const latestUpdate = SessionActivityService.resolveLatestUpdate(statusActivity);
          if (liveStatus === undefined && latestUpdate === undefined) {
            return;
          }

          this.options.state.patch({
            ...(liveStatus !== undefined ? { liveStatus } : {}),
            ...(latestUpdate !== undefined ? { latestUpdate } : {}),
          });
        },
      });
    });
  }

  applyAssistantStreamUpdate(update: AssistantStreamUpdate): void {
    this.options.state.patch((current) => ({
      activeSession: ClientSharedSessionMessageService.upsertLiveAssistantMessage(
        current.activeSession,
        update.text,
        update.done,
      ),
      ...(!update.done ? { liveStatus: 'Receiving assistant response...' } : {}),
    }));
  }
}
