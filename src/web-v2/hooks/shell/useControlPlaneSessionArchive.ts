import type {
  ControlPlaneSessionDetail,
  ControlPlaneSessions,
} from '@web/api/client';
import { trpcReact } from '@web/api/client';
import { toast } from '@web/components/ui/use-toast';
import { useI18n } from '@web/i18n';

type UseControlPlaneSessionArchiveArgs = {
  workspaceId?: string;
  selectedSessionId?: string;
  selectSession: (sessionId: string, options?: { workspaceId?: string; replace?: boolean }) => void;
  selectSurface: (surfaceId: 'sessions', options?: { replace?: boolean }) => void;
};

// useControlPlaneSessionArchive owns the web archive workflow: optimistic list
// removal, route fallback when the active session is archived, and toast undo.
export function useControlPlaneSessionArchive({
  workspaceId,
  selectedSessionId,
  selectSession,
  selectSurface,
}: UseControlPlaneSessionArchiveArgs) {
  const { t } = useI18n();
  const utils = trpcReact.useUtils();
  const sessionArchivedUpdateMutation = trpcReact.controlPlane.sessionArchivedUpdate.useMutation();

  async function setSessionArchived(sessionId: string, archived: boolean) {
    const sessionsInput = workspaceId ? { workspaceId } : undefined;
    const sessionInput = workspaceId ? { workspaceId, id: sessionId } : { id: sessionId };
    const previousSessions = utils.controlPlane.sessions.getData(sessionsInput);
    const previousSession = utils.controlPlane.session.getData(sessionInput);
    const nextSelectedSession = previousSessions?.sessions.find((session) => session.id !== sessionId);

    utils.controlPlane.sessions.setData(
      sessionsInput,
      (current) => archived ? removeSessionFromSessions(current, sessionId) : current,
    );

    try {
      const updated = await sessionArchivedUpdateMutation.mutateAsync({ ...sessionInput, archived });
      utils.controlPlane.sessions.setData(
        sessionsInput,
        (current) => archived ? removeSessionFromSessions(current, sessionId) : upsertSessionInSessions(current, updated),
      );
      utils.controlPlane.session.setData(sessionInput, updated);

      if (archived) {
        if (selectedSessionId === sessionId) {
          if (nextSelectedSession) {
            selectSession(nextSelectedSession.id, { workspaceId, replace: true });
          } else {
            selectSurface('sessions', { replace: true });
          }
        }

        showSessionArchivedToast({
          undo: () => setSessionArchived(sessionId, false),
        });
      }
    } catch (error) {
      utils.controlPlane.sessions.setData(sessionsInput, previousSessions);
      utils.controlPlane.session.setData(sessionInput, previousSession);
      throw error;
    } finally {
      await Promise.all([
        utils.controlPlane.sessions.invalidate(sessionsInput),
        utils.controlPlane.session.invalidate(sessionInput),
      ]);
    }
  }

  function showSessionArchivedToast(args: { undo: () => Promise<void> }) {
    toast({
      title: t('navigation.sessionArchivedToastTitle'),
      body: t('navigation.sessionArchivedToastBody'),
      tone: 'success',
      action: {
        label: t('navigation.undoArchiveSession'),
        onClick: () => {
          void args.undo();
        },
      },
    });
  }

  return {
    setSessionArchived,
    archiving: sessionArchivedUpdateMutation.isPending,
  };
}

function removeSessionFromSessions(
  current: ControlPlaneSessions | undefined,
  sessionId: string,
): ControlPlaneSessions | undefined {
  if (!current) {
    return current;
  }

  return {
    ...current,
    sessions: current.sessions.filter((session) => session.id !== sessionId),
  };
}

function upsertSessionInSessions(
  current: ControlPlaneSessions | undefined,
  session: NonNullable<ControlPlaneSessionDetail>,
): ControlPlaneSessions | undefined {
  if (!current) {
    return current;
  }

  const sessions = current.sessions.some((candidate) => candidate.id === session.id)
    ? current.sessions.map((candidate) => candidate.id === session.id ? session : candidate)
    : [session, ...current.sessions];

  return {
    ...current,
    sessions: sessions.sort(compareSessionViews),
  };
}

function compareSessionViews(
  left: ControlPlaneSessions['sessions'][number],
  right: ControlPlaneSessions['sessions'][number],
): number {
  if (left.pinned !== right.pinned) {
    return left.pinned ? -1 : 1;
  }

  return (right.updatedAt ?? '').localeCompare(left.updatedAt ?? '');
}
