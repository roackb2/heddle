import { Button } from '@/web/components/ui/button';
import { cn } from '@/web/lib/utils';

interface SidebarLinkProps {
  active: boolean;
  href: string;
  label: string;
  onClick: () => void;
}

// SidebarLink is the shared nav row primitive for v2 sidebar modes.
export function SidebarLink({ active, href, label, onClick }: SidebarLinkProps) {
  return (
    <Button
      className={cn('h-8 justify-start px-2 text-muted-foreground', active && 'bg-accent text-accent-foreground')}
      asChild
      variant="ghost"
    >
      <a
        aria-current={active ? 'page' : undefined}
        href={href}
        onClick={() => {
          onClick();
        }}
      >
        {label}
      </a>
    </Button>
  );
}
