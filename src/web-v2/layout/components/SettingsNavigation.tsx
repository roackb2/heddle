import { Button } from '@/web/components/ui/button';
import type { NavigationItem, SettingsSectionId } from '../types';
import { SidebarLink } from './SidebarLink';

interface SettingsNavigationProps {
  activeItemId: SettingsSectionId;
  items: NavigationItem[];
  onBack: () => void;
  onSelect: (id: SettingsSectionId) => void;
}

// SettingsNavigation owns the alternate sidebar mode for configuration surfaces
// that should not crowd the main agent workbench.
export function SettingsNavigation({ activeItemId, items, onBack, onSelect }: SettingsNavigationProps) {
  return (
    <>
      <div className="border-b p-2">
        <Button className="h-8 w-full justify-start px-2 text-muted-foreground" onClick={onBack} type="button" variant="ghost">
          Back to App
        </Button>
      </div>
      <nav className="grid gap-1 p-2" aria-label="Settings navigation">
        {items.map((item) => (
          <SidebarLink
            key={item.id}
            active={item.id === activeItemId}
            href={item.href}
            label={item.label}
            onClick={() => onSelect(item.id as SettingsSectionId)}
          />
        ))}
      </nav>
    </>
  );
}
