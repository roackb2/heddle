import { AppNavigation, SettingsNavigation } from '@web/components/navigation';
import { useI18n } from '@web/i18n';
import type { AppRoute, SettingsRoute } from '@web/layout/routes';
import type { AppSurfaceId, SettingsSectionId } from '@web/layout/types';

interface SessionSidebarProps {
  activeSurfaceId: AppSurfaceId;
  activeSettingsSectionId: SettingsSectionId;
  appNavigationItems: readonly AppRoute[];
  settingsNavigationItems: readonly SettingsRoute[];
  settingsOpen: boolean;
  onOpenSettings: () => void;
  onCloseSettings: () => void;
}

// SessionSidebar owns the primary agent workbench rail: app navigation,
// settings navigation, and the future session list.
export function SessionSidebar({
  activeSurfaceId,
  activeSettingsSectionId,
  appNavigationItems,
  settingsNavigationItems,
  settingsOpen,
  onOpenSettings,
  onCloseSettings,
}: SessionSidebarProps) {
  const { t } = useI18n();

  return (
    <aside className="flex h-full min-w-0 flex-col bg-card text-sm" aria-label={t('navigation.primaryAriaLabel')}>
      {settingsOpen ? (
        <SettingsNavigation
          activeItemId={activeSettingsSectionId}
          items={settingsNavigationItems}
          onBack={onCloseSettings}
        />
      ) : (
        <AppNavigation
          activeItemId={activeSurfaceId}
          items={appNavigationItems}
          onOpenSettings={onOpenSettings}
        />
      )}
    </aside>
  );
}
