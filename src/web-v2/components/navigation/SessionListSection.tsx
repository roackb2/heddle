import { useState, type FormEvent, type KeyboardEvent } from 'react';
import type { ControlPlaneState } from '@web/api/client';
import { Button } from '@web/components/ui/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@web/components/ui/context-menu';
import { FieldError } from '@web/components/ui/field';
import { Input } from '@web/components/ui/input';
import { useI18n } from '@web/i18n';
import { cn } from '@web/lib/utils';
import { Pencil, Plus } from 'lucide-react';

interface SessionListSectionProps {
  selectedSessionId?: string;
  sessions: ControlPlaneState['sessions'];
  title: string;
  onCreateSession: () => Promise<void>;
  onRenameSession: (sessionId: string, name: string) => Promise<void>;
  onSelectSession: (sessionId: string) => void;
}

type RenameSessionDraft = {
  id: string;
  name: string;
};

// SessionListSection renders the left-rail session list using the same view
// shape returned by the control-plane tRPC sessions endpoint.
export function SessionListSection({
  selectedSessionId,
  sessions,
  title,
  onCreateSession,
  onRenameSession,
  onSelectSession,
}: SessionListSectionProps) {
  const { t } = useI18n();
  const [renamingSession, setRenamingSession] = useState<RenameSessionDraft>();
  const [renameError, setRenameError] = useState<string>();
  const [renameSubmitting, setRenameSubmitting] = useState(false);

  function startRename(session: ControlPlaneState['sessions'][number]) {
    setRenameError(undefined);
    setRenamingSession({ id: session.id, name: session.name });
  }

  function cancelRename() {
    if (renameSubmitting) {
      return;
    }

    setRenamingSession(undefined);
    setRenameError(undefined);
  }

  function updateRenamingSessionName(name: string) {
    setRenamingSession((current) => current ? { ...current, name } : current);
  }

  async function submitRename(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();

    if (!renamingSession || renameSubmitting) {
      return;
    }

    const name = renamingSession.name.trim();
    const originalName = sessions.find((session) => session.id === renamingSession.id)?.name;
    if (!name) {
      setRenameError(t('navigation.renameSessionEmpty'));
      return;
    }
    if (name === originalName) {
      setRenamingSession(undefined);
      setRenameError(undefined);
      return;
    }

    setRenameError(undefined);
    setRenameSubmitting(true);
    try {
      await onRenameSession(renamingSession.id, name);
      setRenamingSession(undefined);
    } catch (error) {
      setRenameError(error instanceof Error ? error.message : String(error));
    } finally {
      setRenameSubmitting(false);
    }
  }

  function handleRenameKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelRename();
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      void submitRename();
    }
  }

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
      <div
        className="v2-type-section-label px-2 pt-2 pb-1 tracking-normal text-muted-foreground"
      >
        {title}
      </div>
      <div className="v2-scrollbar-hidden flex min-h-0 flex-1 flex-col gap-0.5 overflow-auto">
        {sessions.map((session) => {
          const selected = selectedSessionId === session.id;
          const renaming = renamingSession?.id === session.id;

          if (renaming) {
            return (
              <form
                key={session.id}
                className={cn(
                  'relative flex w-full min-w-0 flex-col rounded-md py-1.5 pl-4 pr-2 text-left',
                  selected && 'bg-sidebar-accent text-sidebar-accent-foreground',
                )}
                onSubmit={(event) => void submitRename(event)}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'absolute bottom-1.5 left-1 top-1.5 w-0.5 rounded-full bg-transparent',
                    selected && 'bg-sidebar-accent-foreground',
                  )}
                />
                <Input
                  autoFocus
                  aria-label={t('navigation.renameSessionLabel')}
                  aria-invalid={renameError ? true : undefined}
                  aria-describedby={renameError ? `session-rename-error-${session.id}` : undefined}
                  className="h-5 rounded-sm border-sidebar-border bg-sidebar px-1 py-0 shadow-none"
                  disabled={renameSubmitting}
                  value={renamingSession.name}
                  onBlur={() => void submitRename()}
                  onChange={(event) => updateRenamingSessionName(event.target.value)}
                  onFocus={(event) => event.currentTarget.select()}
                  onKeyDown={handleRenameKeyDown}
                />
                {renameError ? (
                  <FieldError id={`session-rename-error-${session.id}`} className="pt-1">
                    {renameError}
                  </FieldError>
                ) : (
                  <span
                    className={cn(
                      'v2-type-nav-secondary w-full truncate text-muted-foreground',
                      selected && 'text-sidebar-accent-foreground/75',
                    )}
                  >
                    {session.lastSummary ?? session.lastPrompt ?? session.model ?? session.id}
                  </span>
                )}
              </form>
            );
          }

          return (
            <ContextMenu key={session.id}>
              <ContextMenuTrigger asChild>
                <button
                  type="button"
                  aria-current={selected ? 'true' : undefined}
                  className={cn(
                    'group relative flex w-full min-w-0 flex-col rounded-md py-1.5 pl-4 pr-2 text-left outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-1 focus-visible:ring-sidebar-ring',
                    selected && 'bg-sidebar-accent text-sidebar-accent-foreground',
                  )}
                  onClick={() => onSelectSession(session.id)}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'absolute bottom-1.5 left-1 top-1.5 w-0.5 rounded-full bg-transparent',
                      selected && 'bg-sidebar-accent-foreground',
                    )}
                  />
                  <span
                    className={cn(
                      'v2-type-nav-primary w-full truncate text-sidebar-foreground group-hover:text-sidebar-accent-foreground',
                      selected && 'text-sidebar-accent-foreground',
                    )}
                  >
                    {session.name}
                  </span>
                  <span
                    className={cn(
                      'v2-type-nav-secondary w-full truncate text-muted-foreground',
                      selected && 'text-sidebar-accent-foreground/75',
                    )}
                  >
                    {session.lastSummary ?? session.lastPrompt ?? session.model ?? session.id}
                  </span>
                </button>
              </ContextMenuTrigger>
              <ContextMenuContent alignOffset={8} className="w-44">
                <ContextMenuItem onSelect={() => startRename(session)}>
                  <Pencil aria-hidden="true" />
                  <span>{t('navigation.renameSession')}</span>
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          );
        })}
      </div>
    </section>
  );
}
