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
        'v2-nav-row',
        active && 'v2-nav-row-active',
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
