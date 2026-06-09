import type { ReactNode } from 'react';
import type { ControlPlaneState } from '@web/api/client';

interface SessionListGroupProps {
  emptyLabel?: string;
  renderSession: (session: ControlPlaneState['sessions'][number]) => ReactNode;
  sessions: ControlPlaneState['sessions'];
  title: string;
}

export function SessionListGroup({
  emptyLabel,
  renderSession,
  sessions,
  title,
}: SessionListGroupProps) {
  return (
    <>
      <SessionSectionLabel>{title}</SessionSectionLabel>
      {sessions.length > 0 ?
        sessions.map(renderSession)
      : emptyLabel ? (
        <SessionListEmptyState>{emptyLabel}</SessionListEmptyState>
      ) : null}
    </>
  );
}

function SessionSectionLabel({ children }: { children: string }) {
  return (
    <div
      className="v2-type-section-label px-2 pt-2 pb-1 tracking-normal text-muted-foreground"
    >
      {children}
    </div>
  );
}

function SessionListEmptyState({ children }: { children: string }) {
  return (
    <div className="v2-type-nav-secondary px-4 py-1.5 text-muted-foreground/75">
      {children}
    </div>
  );
}
