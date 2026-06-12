import { useCallback } from 'react';
import { skipToken } from '@tanstack/react-query';
import {
  ClientSharedNotificationIntentService,
  type ClientSharedNotificationIntent,
} from '@/client-shared/services/notifications';
import { trpcReact, type ControlPlaneSessionsEventEnvelope } from '@web/api/client';

type UseControlPlaneWorkspaceSessionEventsArgs = {
  onNotificationIntent?: (intent: ClientSharedNotificationIntent | undefined) => void;
  workspaceId?: string;
};

// Owns workspace-scoped session event side effects for web-v2. Detailed
// selected-session rendering stays in useControlPlaneSessionEvents; this hook
// keeps app-wide notifications and list refreshes active for the open workspace.
export function useControlPlaneWorkspaceSessionEvents({
  onNotificationIntent,
  workspaceId,
}: UseControlPlaneWorkspaceSessionEventsArgs): void {
  const utils = trpcReact.useUtils();
  const applyWorkspaceSessionEvent = useCallback((event: ControlPlaneSessionsEventEnvelope) => {
    if (event.type === 'sessions.updated') {
      void utils.controlPlane.sessions.invalidate(workspaceId ? { workspaceId } : undefined);
      void utils.controlPlane.state.invalidate();
      return;
    }

    if (event.type !== 'session.event') {
      return;
    }

    event.activities.forEach((activity) => {
      onNotificationIntent?.(ClientSharedNotificationIntentService.projectSessionActivity({
        workspaceId,
        sessionId: event.sessionId,
        activity,
      }));
    });
  }, [onNotificationIntent, utils, workspaceId]);

  trpcReact.controlPlane.sessionsEvents.useSubscription(
    workspaceId ? { workspaceId } : skipToken,
    {
      onData: applyWorkspaceSessionEvent,
    },
  );
}
