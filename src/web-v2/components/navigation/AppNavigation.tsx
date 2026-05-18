import { Button } from '@/web/components/ui/button';
import { useI18n } from '../../i18n';
import type { AppSurfaceId, NavigationItem } from '../../layout/types';
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
  const { t } = useI18n();

  return (
    <>
      <div className="border-b px-3 py-2 text-sm font-medium text-foreground">Heddle</div>
      <nav className="grid gap-1 p-2" aria-label={t('navigation.mainAriaLabel')}>
        {items.map((item) => (
          <SidebarLink
            key={item.id}
            active={item.id === activeItemId}
            href={item.href}
            label={t(item.labelKey)}
            onClick={() => onSelect(item.id as AppSurfaceId)}
          />
        ))}
      </nav>
      <div className="min-h-0 flex-1 border-t bg-background" aria-label={t('navigation.sessionListAriaLabel')} />
      <div className="border-t p-2">
        <Button className="h-8 w-full justify-start px-2" onClick={onOpenSettings} type="button" variant="ghost">
          {t('navigation.settings')}
        </Button>
      </div>
    </>
  );
}
