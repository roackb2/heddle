import { Button } from '../../../components/ui/button';
import { cn } from '../../../lib/utils';

export type MobileSessionView = 'chat' | 'review';

type MobileSessionNavProps = {
  activeView: MobileSessionView;
  title: string;
  subtitle?: string;
  onBackToSessions: () => void;
  onOpenChat: () => void;
  onOpenReview: () => void;
};

export function MobileSessionNav({
  activeView,
  title,
  subtitle,
  onBackToSessions,
  onOpenChat,
  onOpenReview,
}: MobileSessionNavProps) {
  return (
    <header className="shrink-0 border-b border-border bg-card px-3 py-2">
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2">
        <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={onBackToSessions}>
          ‹ Sessions
        </Button>
        <div className="min-w-0 text-center">
          <h2 className="m-0 truncate text-sm font-semibold leading-5 tracking-normal">{title}</h2>
          {subtitle ? <p className="m-0 truncate text-xs leading-4 text-muted-foreground">{subtitle}</p> : null}
        </div>
        <div className="w-[76px]" aria-hidden="true" />
      </div>

      <nav className="mt-2 grid grid-cols-2 rounded-md bg-muted p-1" aria-label="Session views">
        <SessionNavButton active={activeView === 'chat'} onClick={onOpenChat}>Chat</SessionNavButton>
        <SessionNavButton active={activeView === 'review'} onClick={onOpenReview}>Review</SessionNavButton>
      </nav>
    </header>
  );
}

function SessionNavButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      className={cn(
        'h-8 rounded-md text-xs font-medium text-muted-foreground transition-colors',
        active && 'bg-background text-foreground shadow-sm',
      )}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
