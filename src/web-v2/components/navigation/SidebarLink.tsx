import { Link } from 'react-router';
import { MessageSquare, ListTodo } from 'lucide-react';
import { Button } from '@web/components/ui/button';
import { cn } from '@web/lib/utils';
import type { AppSurfaceId } from '@web/layout/types';

interface SidebarLinkProps {
  active: boolean;
  href: string;
  label: string;
  surfaceId?: AppSurfaceId;
}

// SidebarLink is the shared nav row primitive for v2 sidebar modes.
export function SidebarLink({ active, href, label, surfaceId }: SidebarLinkProps) {
  const Icon = surfaceId ? sidebarIconBySurface[surfaceId] : undefined;

  return (
    <Button
      className={cn(
        'h-7 justify-start rounded-md px-2 text-sm font-normal text-muted-foreground hover:bg-accent/70 hover:text-foreground',
        active && 'bg-accent text-accent-foreground hover:bg-accent',
      )}
      asChild
      variant="ghost"
    >
      <Link
        aria-current={active ? 'page' : undefined}
        to={href}
      >
        {Icon && <Icon className="size-3.5" aria-hidden="true" />}
        {label}
      </Link>
    </Button>
  );
}

const sidebarIconBySurface = {
  sessions: MessageSquare,
  tasks: ListTodo,
} satisfies Record<AppSurfaceId, typeof MessageSquare>;
