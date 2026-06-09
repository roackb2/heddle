import type { ControlPlaneState } from '@web/api/client';
import { Button } from '@web/components/ui/button';
import { useInlineSessionRename } from '@web/hooks/shell/useInlineSessionRename';
import { useI18n } from '@web/i18n';
import { Plus } from 'lucide-react';
import { SessionListGroup } from './SessionListGroup';
import { SessionListItem } from './SessionListItem';

interface SessionListSectionProps {
  selectedSessionId?: string;
  sessions: ControlPlaneState['sessions'];
  title: string;
  onCreateSession: () => Promise<void>;
  onRenameSession: (sessionId: string, name: string) => Promise<void>;
  onSetSessionArchived: (sessionId: string, archived: boolean) => Promise<void>;
  onSetSessionPinned: (sessionId: string, pinned: boolean) => Promise<void>;
  onSelectSession: (sessionId: string) => void;
}

// SessionListSection renders the left-rail session list using the same view
// shape returned by the control-plane tRPC sessions endpoint.
export function SessionListSection({
  selectedSessionId,
  sessions,
  title,
  onCreateSession,
  onRenameSession,
  onSetSessionArchived,
  onSetSessionPinned,
  onSelectSession,
}: SessionListSectionProps) {
  const { t } = useI18n();
  const {
    handleRenameKeyDown,
    renameError,
    renameSubmitting,
    renamingSession,
    startRename,
    submitRename,
    updateRenamingSessionName,
  } = useInlineSessionRename({
    emptyNameError: t('navigation.renameSessionEmpty'),
    onRenameSession,
    sessions,
  });
  const pinnedSessions = sessions.filter((session) => session.pinned);
  const regularSessions = sessions.filter((session) => !session.pinned);

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-1 px-2 py-2" aria-label={title}>
      <Button
        type="button"
        variant="ghost"
        size="none"
        className="v2-sidebar-action"
        onClick={() => void onCreateSession()}
      >
        <Plus aria-hidden="true" />
        <span>{t('navigation.newChat')}</span>
      </Button>
      <div className="v2-scrollbar-hidden flex min-h-0 flex-1 flex-col gap-0.5 overflow-auto">
        <SessionListGroup
          emptyLabel={t('navigation.pinnedSessionsEmpty')}
          sessions={pinnedSessions}
          title={t('navigation.pinnedSessionsTitle')}
          renderSession={renderSession}
        />
        {regularSessions.length > 0 || pinnedSessions.length === 0 ? (
          <SessionListGroup
            sessions={regularSessions}
            title={title}
            renderSession={renderSession}
          />
        ) : null}
      </div>
    </section>
  );

  function renderSession(session: ControlPlaneState['sessions'][number]) {
    return (
      <SessionListItem
        key={session.id}
        renamingName={renamingSession?.id === session.id ? renamingSession.name : undefined}
        renameError={renameError}
        renameSubmitting={renameSubmitting}
        selected={selectedSessionId === session.id}
        session={session}
        onRenameKeyDown={handleRenameKeyDown}
        onSelectSession={onSelectSession}
        onSetSessionArchived={onSetSessionArchived}
        onSetSessionPinned={onSetSessionPinned}
        onStartRename={startRename}
        onSubmitRename={submitRename}
        onUpdateRenamingSessionName={updateRenamingSessionName}
      />
    );
  }
}
