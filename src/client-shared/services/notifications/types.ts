import type {
  ControlPlaneHeartbeatEventEnvelope,
  ControlPlaneSessionEventEnvelope,
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
  ControlPlaneSessionEventEnvelope,
  { type: 'session.event' }
>['activities'][number];

export type ClientSharedHeartbeatEventEnvelope = ControlPlaneHeartbeatEventEnvelope;
