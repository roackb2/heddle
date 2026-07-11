import type {
  ControlPlaneHeartbeatEventEnvelope,
  ControlPlaneSessionRunEventEnvelope,
  ControlPlaneSessionsEventEnvelope,
} from '@/client-shared/api/types.js';

export type ClientSharedNotificationTone = 'info' | 'success' | 'warning' | 'error';

export type ClientSharedNotificationIntent = {
  key: string;
  title: string;
  body?: string;
  tone: ClientSharedNotificationTone;
  timestamp: string;
  workspaceId?: string;
  sessionId?: string;
  taskId?: string;
  runId?: string;
};

export type ClientSharedSessionNotificationActivity = Extract<
  ControlPlaneSessionRunEventEnvelope,
  { kind: 'activity' }
>['activity'];

export type ClientSharedSessionRunTerminalEnvelope = Extract<
  ControlPlaneSessionsEventEnvelope,
  { type: 'session.run.terminal' }
>;

export type ClientSharedSessionApprovalEnvelope = Extract<
  ControlPlaneSessionsEventEnvelope,
  { type: 'session.approval.updated' }
>;

export type ClientSharedHeartbeatEventEnvelope = ControlPlaneHeartbeatEventEnvelope;
