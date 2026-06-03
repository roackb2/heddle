import type {
  ClientSharedAgentActivityStatus,
  ClientSharedRecentEditDiff,
  ClientSharedSessionPlan,
} from '@/client-shared/services/session-activities/index.js';
import type { ControlPlaneProxyClient } from '@/client-shared/api/proxy.js';
import type {
  ControlPlaneApprovalDecision,
  ControlPlaneModelOptions,
  ControlPlanePendingApproval,
  ControlPlaneSessionDirectShellPreflight,
  ControlPlaneSessionDetail,
  ControlPlaneSessionRuntimeContext,
  ControlPlaneSessionView,
  ControlPlaneSlashCommandCatalog,
  ControlPlaneSlashCommandResult,
} from '@/client-shared/api/types.js';
import type { ControlPlaneSessionLatestUpdate } from '../services/activities/session-activity-service.js';

export type ControlPlaneSessionStoreOptions = {
  client: ControlPlaneProxyClient;
  defaultModel?: string;
  maxSteps?: number;
  searchIgnoreDirs?: string[];
  systemContext?: string;
  apiKey?: string;
  preferApiKey?: boolean;
};

export type ControlPlaneSessionStoreStartInput = {
  workspaceId?: string;
  sessionId?: string;
};

export type ControlPlaneSessionStoreSnapshot = {
  workspaceId?: string;
  sessions: ControlPlaneSessionView[];
  activeSessionId?: string;
  activeSession: ControlPlaneSessionDetail;
  runtimeContext?: ControlPlaneSessionRuntimeContext;
  modelOptions?: ControlPlaneModelOptions;
  pendingApproval: ControlPlanePendingApproval;
  pendingDirectShellConfirmation?: ControlPlaneSessionDirectShellPreflight;
  loading: boolean;
  submitting: boolean;
  approvalResolving: boolean;
  running: boolean;
  cancelling: boolean;
  streamConnected: boolean;
  liveStatus?: string;
  currentActivity?: ClientSharedAgentActivityStatus;
  activePlan?: ClientSharedSessionPlan;
  recentEditDiffs: ClientSharedRecentEditDiff[];
  latestUpdate?: ControlPlaneSessionLatestUpdate;
  slashCommandCatalog?: ControlPlaneSlashCommandCatalog;
  commandResults: ControlPlaneSlashCommandResult[];
  error?: string;
};

export type ControlPlaneSessionSnapshotPatch =
  | Partial<ControlPlaneSessionStoreSnapshot>
  | ((current: ControlPlaneSessionStoreSnapshot) => Partial<ControlPlaneSessionStoreSnapshot>);

export const INITIAL_CONTROL_PLANE_SESSION_SNAPSHOT: ControlPlaneSessionStoreSnapshot = {
  sessions: [],
  activeSession: null,
  runtimeContext: undefined,
  modelOptions: undefined,
  pendingApproval: null,
  pendingDirectShellConfirmation: undefined,
  loading: false,
  submitting: false,
  approvalResolving: false,
  running: false,
  cancelling: false,
  streamConnected: false,
  recentEditDiffs: [],
  commandResults: [],
};

/**
 * Owns the cli-v2 render snapshot and subscription mechanics.
 *
 * This class must stay generic: no API calls, no domain policy, no event
 * interpretation. Workflow controllers produce patches; this state object is
 * the single mutable source of truth consumed by Ink components.
 */
export class ControlPlaneSessionState {
  private readonly listeners = new Set<() => void>();
  private snapshotValue: ControlPlaneSessionStoreSnapshot = INITIAL_CONTROL_PLANE_SESSION_SNAPSHOT;

  constructor(private readonly onChanged?: () => void) {}

  getSnapshot = (): ControlPlaneSessionStoreSnapshot => this.snapshotValue;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  patch(next: ControlPlaneSessionSnapshotPatch): void {
    const patch = typeof next === 'function' ? next(this.snapshotValue) : next;
    this.snapshotValue = {
      ...this.snapshotValue,
      ...patch,
    };
    this.onChanged?.();
    this.listeners.forEach((listener) => listener());
  }

  requireWorkspaceId(): string {
    const workspaceId = this.snapshotValue.workspaceId;
    if (!workspaceId) {
      throw new Error('Control-plane workspace is not loaded.');
    }
    return workspaceId;
  }

  requireActiveSessionId(): string {
    const sessionId = this.snapshotValue.activeSessionId;
    if (!sessionId) {
      throw new Error('No active control-plane session is selected.');
    }
    return sessionId;
  }

  isActiveSessionAddress(workspaceId: string, sessionId: string): boolean {
    return this.snapshotValue.workspaceId === workspaceId && this.snapshotValue.activeSessionId === sessionId;
  }
}

export type { ControlPlaneApprovalDecision };
