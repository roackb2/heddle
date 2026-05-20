import { Link } from 'react-router';
import { MessageSquare, ListTodo } from 'lucide-react';
import { SidebarMenuButton } from '@web/components/ui/sidebar';
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
    <SidebarMenuButton asChild isActive={active} tooltip={label}>
      <Link
        aria-current={active ? 'page' : undefined}
        to={href}
      >
        {Icon && <Icon aria-hidden="true" />}
        <span>{label}</span>
      </Link>
    </SidebarMenuButton>
  );
}

const sidebarIconBySurface = {
  sessions: MessageSquare,
  tasks: ListTodo,
} satisfies Record<AppSurfaceId, typeof MessageSquare>;
