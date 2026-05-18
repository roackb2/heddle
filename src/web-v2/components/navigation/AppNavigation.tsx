import { useI18n } from '@web/i18n';
import type { AppSurfaceId, NavigationItem } from '@web/layout/types';
import { SettingsMenu } from './SettingsMenu';
import { SidebarLink } from './SidebarLink';

interface AppNavigationProps {
  activeItemId: AppSurfaceId;
  items: readonly NavigationItem[];
  onOpenSettings: () => void;
}

// AppNavigation owns the primary workbench sidebar mode: app surfaces, the
// future session list region, and the bottom settings entry point.
export function AppNavigation({ activeItemId, items, onOpenSettings }: AppNavigationProps) {
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
          />
        ))}
      </nav>
      <div className="min-h-0 flex-1 border-t bg-background" aria-label={t('navigation.sessionListAriaLabel')} />
      <div className="border-t p-2">
        <SettingsMenu onOpenSettings={onOpenSettings} />
      </div>
    </>
  );
}
