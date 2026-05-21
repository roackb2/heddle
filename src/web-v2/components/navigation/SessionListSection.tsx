import type { ControlPlaneState } from '@web/api/client';

interface SessionListSectionProps {
  selectedSessionId?: string;
  sessions: ControlPlaneState['sessions'];
  title: string;
  onSelectSession: (sessionId: string) => void;
}

// SessionListSection renders the left-rail session list using the same view
// shape returned by the control-plane tRPC sessions endpoint.
export function SessionListSection({ selectedSessionId, sessions, title, onSelectSession }: SessionListSectionProps) {
  return (
    <section className="flex min-h-0 flex-1 flex-col gap-1 px-2 py-2" aria-label={title}>
      <div
        className="px-2 pb-1 text-[0.6875rem] font-medium uppercase tracking-normal text-muted-foreground"
      >
        {title}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-auto">
        {sessions.map((session) => (
          <button
            key={session.id}
            type="button"
            aria-current={selectedSessionId === session.id ? 'page' : undefined}
            className="group flex w-full min-w-0 flex-col rounded-md px-2 py-1.5 text-left outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-1 focus-visible:ring-sidebar-ring aria-current-page:bg-sidebar-accent aria-current-page:text-sidebar-accent-foreground"
            onClick={() => onSelectSession(session.id)}
          >
            <span className="w-full truncate text-sm font-medium leading-5 text-sidebar-foreground group-hover:text-sidebar-accent-foreground">
              {session.name}
            </span>
            <span className="w-full truncate text-xs leading-4 text-muted-foreground">
              {session.lastSummary ?? session.lastPrompt ?? session.model ?? session.id}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
