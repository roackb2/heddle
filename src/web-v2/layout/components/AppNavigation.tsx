import { Button } from '@/web/components/ui/button';
import type { AppSurfaceId, NavigationItem } from '../types';
import { SidebarLink } from './SidebarLink';

interface AppNavigationProps {
  activeItemId: AppSurfaceId;
  items: NavigationItem[];
  onOpenSettings: () => void;
  onSelect: (id: AppSurfaceId) => void;
}

// AppNavigation owns the primary workbench sidebar mode: app surfaces, the
// future session list region, and the bottom settings entry point.
export function AppNavigation({ activeItemId, items, onOpenSettings, onSelect }: AppNavigationProps) {
  return (
    <>
      <div className="border-b px-3 py-2 text-sm font-medium text-foreground">Heddle</div>
      <nav className="grid gap-1 p-2" aria-label="Main app navigation">
        {items.map((item) => (
          <SidebarLink
            key={item.id}
            active={item.id === activeItemId}
            href={item.href}
            label={item.label}
            onClick={() => onSelect(item.id as AppSurfaceId)}
          />
        ))}
      </nav>
      <div className="min-h-0 flex-1 border-t bg-background" aria-label="Session list" />
      <div className="border-t p-2">
        <Button className="h-8 w-full justify-start px-2" onClick={onOpenSettings} type="button" variant="ghost">
          Settings
        </Button>
      </div>
    </>
  );
}
