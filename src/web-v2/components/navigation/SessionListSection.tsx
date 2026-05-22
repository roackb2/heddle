import type { ControlPlaneState } from '@web/api/client';
import { Button } from '@web/components/ui/button';
import { useI18n } from '@web/i18n';
import { cn } from '@web/lib/utils';
import { Plus } from 'lucide-react';

interface SessionListSectionProps {
  selectedSessionId?: string;
  sessions: ControlPlaneState['sessions'];
  title: string;
  onCreateSession: () => Promise<void>;
  onSelectSession: (sessionId: string) => void;
}

// SessionListSection renders the left-rail session list using the same view
// shape returned by the control-plane tRPC sessions endpoint.
export function SessionListSection({
  selectedSessionId,
  sessions,
  title,
  onCreateSession,
  onSelectSession,
}: SessionListSectionProps) {
  const { t } = useI18n();

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
        className="px-2 pt-2 pb-1 text-[0.6875rem] font-medium uppercase tracking-normal text-muted-foreground"
      >
        {title}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-auto">
        {sessions.map((session) => {
          const selected = selectedSessionId === session.id;

          return (
            <button
              key={session.id}
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
                  'w-full truncate text-sm font-medium leading-5 text-sidebar-foreground group-hover:text-sidebar-accent-foreground',
                  selected && 'text-sidebar-accent-foreground',
                )}
              >
                {session.name}
              </span>
              <span
                className={cn(
                  'w-full truncate text-xs leading-4 text-muted-foreground',
                  selected && 'text-sidebar-accent-foreground/75',
                )}
              >
                {session.lastSummary ?? session.lastPrompt ?? session.model ?? session.id}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
