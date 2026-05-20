import { useI18n } from '@web/i18n';
import type { AppRoute } from '@web/layout/routes';
import type { AppSurfaceId } from '@web/layout/types';
import { MainNavigationSection } from './MainNavigationSection';
import { SidebarContentRegion } from './SidebarContentRegion';
import { SidebarSettingsEntry } from './SidebarSettingsEntry';

interface AppNavigationProps {
  activeItemId: AppSurfaceId;
  items: readonly AppRoute[];
  onOpenSettings: () => void;
}

// AppNavigation owns the primary workbench sidebar mode: app surfaces, the
// future session list region, and the bottom settings entry point.
export function AppNavigation({ activeItemId, items, onOpenSettings }: AppNavigationProps) {
  const { t } = useI18n();

  return (
    <>
      <div className="border-b border-border/70 px-3 py-2 text-sm font-medium text-foreground">Heddle</div>
      <MainNavigationSection activeItemId={activeItemId} items={items} />
      <SidebarContentRegion ariaLabel={t('navigation.sessionListAriaLabel')} />
      <SidebarSettingsEntry onOpenSettings={onOpenSettings} />
    </>
  );
}
