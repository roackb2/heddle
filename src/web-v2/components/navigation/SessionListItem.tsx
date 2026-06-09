import type { FormEvent, KeyboardEventHandler } from 'react';
import type { ControlPlaneState } from '@web/api/client';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@web/components/ui/context-menu';
import { FieldError } from '@web/components/ui/field';
import { Input } from '@web/components/ui/input';
import { useI18n } from '@web/i18n';
import { cn } from '@web/lib/utils';
import { Pencil, Pin, PinOff } from 'lucide-react';

interface SessionListItemProps {
  renamingName?: string;
  renameError?: string;
  renameSubmitting: boolean;
  selected: boolean;
  session: ControlPlaneState['sessions'][number];
  onRenameKeyDown: KeyboardEventHandler<HTMLInputElement>;
  onSelectSession: (sessionId: string) => void;
  onSetSessionPinned: (sessionId: string, pinned: boolean) => Promise<void>;
  onStartRename: (session: ControlPlaneState['sessions'][number]) => void;
  onSubmitRename: (event?: FormEvent<HTMLFormElement>) => Promise<void>;
  onUpdateRenamingSessionName: (name: string) => void;
}

export function SessionListItem({
  renamingName,
  renameError,
  renameSubmitting,
  selected,
  session,
  onRenameKeyDown,
  onSelectSession,
  onSetSessionPinned,
  onStartRename,
  onSubmitRename,
  onUpdateRenamingSessionName,
}: SessionListItemProps) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="w-full">
          {renamingName === undefined ? (
            <SessionListItemButton
              selected={selected}
              session={session}
              onSelectSession={onSelectSession}
            />
          ) : (
            <SessionRenameForm
              renameError={renameError}
              renameSubmitting={renameSubmitting}
              renamingName={renamingName}
              selected={selected}
              session={session}
              onRenameKeyDown={onRenameKeyDown}
              onSubmitRename={onSubmitRename}
              onUpdateRenamingSessionName={onUpdateRenamingSessionName}
            />
          )}
        </div>
      </ContextMenuTrigger>
      <SessionListItemMenu
        session={session}
        onSetSessionPinned={onSetSessionPinned}
        onStartRename={onStartRename}
      />
    </ContextMenu>
  );
}

function SessionRenameForm({
  renameError,
  renameSubmitting,
  renamingName,
  selected,
  session,
  onRenameKeyDown,
  onSubmitRename,
  onUpdateRenamingSessionName,
}: {
  renameError?: string;
  renameSubmitting: boolean;
  renamingName: string;
  selected: boolean;
  session: ControlPlaneState['sessions'][number];
  onRenameKeyDown: KeyboardEventHandler<HTMLInputElement>;
  onSubmitRename: (event?: FormEvent<HTMLFormElement>) => Promise<void>;
  onUpdateRenamingSessionName: (name: string) => void;
}) {
  const { t } = useI18n();

  return (
    <form
      className={cn(
        'relative flex w-full min-w-0 flex-col rounded-md py-1.5 pl-4 pr-2 text-left',
        selected && 'bg-sidebar-accent text-sidebar-accent-foreground',
      )}
      onSubmit={(event) => void onSubmitRename(event)}
    >
      <SessionSelectionMarker selected={selected} />
      <Input
        autoFocus
        aria-label={t('navigation.renameSessionLabel')}
        aria-invalid={renameError ? true : undefined}
        aria-describedby={renameError ? `session-rename-error-${session.id}` : undefined}
        className="h-5 rounded-sm border-sidebar-border bg-sidebar px-1 py-0 shadow-none"
        disabled={renameSubmitting}
        value={renamingName}
        onBlur={() => void onSubmitRename()}
        onChange={(event) => onUpdateRenamingSessionName(event.target.value)}
        onFocus={(event) => event.currentTarget.select()}
        onKeyDown={onRenameKeyDown}
      />
      {renameError ? (
        <FieldError id={`session-rename-error-${session.id}`} className="pt-1">
          {renameError}
        </FieldError>
      ) : (
        <SessionSecondaryText selected={selected} session={session} />
      )}
    </form>
  );
}

function SessionListItemButton({
  selected,
  session,
  onSelectSession,
}: {
  selected: boolean;
  session: ControlPlaneState['sessions'][number];
  onSelectSession: (sessionId: string) => void;
}) {
  return (
    <button
      type="button"
      aria-current={selected ? 'true' : undefined}
      className={cn(
        'group relative flex w-full min-w-0 flex-col rounded-md py-1.5 pl-4 pr-2 text-left outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-1 focus-visible:ring-sidebar-ring',
        selected && 'bg-sidebar-accent text-sidebar-accent-foreground',
      )}
      onClick={() => onSelectSession(session.id)}
    >
      <SessionSelectionMarker selected={selected} />
      <span className="flex w-full min-w-0 items-center gap-1.5">
        <span
          className={cn(
            'v2-type-nav-primary min-w-0 flex-1 truncate text-sidebar-foreground group-hover:text-sidebar-accent-foreground',
            selected && 'text-sidebar-accent-foreground',
          )}
        >
          {session.name}
        </span>
        {session.pinned ? (
          <Pin
            aria-hidden="true"
            className={cn(
              'size-3.5 shrink-0 text-muted-foreground',
              selected && 'text-sidebar-accent-foreground/75',
            )}
          />
        ) : null}
      </span>
      <SessionSecondaryText selected={selected} session={session} />
    </button>
  );
}

function SessionListItemMenu({
  session,
  onSetSessionPinned,
  onStartRename,
}: {
  session: ControlPlaneState['sessions'][number];
  onSetSessionPinned: (sessionId: string, pinned: boolean) => Promise<void>;
  onStartRename: (session: ControlPlaneState['sessions'][number]) => void;
}) {
  const { t } = useI18n();

  return (
    <ContextMenuContent alignOffset={8} className="w-44">
      <ContextMenuItem onSelect={() => void onSetSessionPinned(session.id, !session.pinned)}>
        {session.pinned ? <PinOff aria-hidden="true" /> : <Pin aria-hidden="true" />}
        <span>{session.pinned ? t('navigation.unpinSession') : t('navigation.pinSession')}</span>
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={() => onStartRename(session)}>
        <Pencil aria-hidden="true" />
        <span>{t('navigation.renameSession')}</span>
      </ContextMenuItem>
    </ContextMenuContent>
  );
}

function SessionSelectionMarker({ selected }: { selected: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'absolute bottom-1.5 left-1 top-1.5 w-0.5 rounded-full bg-transparent',
        selected && 'bg-sidebar-accent-foreground',
      )}
    />
  );
}

function SessionSecondaryText({
  selected,
  session,
}: {
  selected: boolean;
  session: ControlPlaneState['sessions'][number];
}) {
  return (
    <span
      className={cn(
        'v2-type-nav-secondary w-full truncate text-muted-foreground',
        selected && 'text-sidebar-accent-foreground/75',
      )}
    >
      {session.lastSummary ?? session.lastPrompt ?? session.model ?? session.id}
    </span>
  );
}
