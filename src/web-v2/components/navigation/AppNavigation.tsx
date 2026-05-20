import {
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
} from '@web/components/ui/sidebar';
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
      <SidebarHeader className="v2-panel-divider h-12 justify-center border-b px-2 py-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">Heddle</span>
        </div>
      </SidebarHeader>
      <MainNavigationSection activeItemId={activeItemId} items={items} />
      <SidebarContent>
        <SidebarContentRegion ariaLabel={t('navigation.sessionListAriaLabel')} />
      </SidebarContent>
      <SidebarFooter className="v2-panel-divider border-t p-1.5">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarSettingsEntry onOpenSettings={onOpenSettings} />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </>
  );
}
