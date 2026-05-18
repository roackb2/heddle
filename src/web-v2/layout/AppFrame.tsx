import type { PropsWithChildren } from 'react';
import { AppNavigation } from './components/AppNavigation';
import { SettingsNavigation } from './components/SettingsNavigation';
import type { AppSurfaceId, NavigationItem, SettingsSectionId } from './types';

interface AppFrameProps {
  activeSurfaceId: AppSurfaceId;
  activeSettingsSectionId: SettingsSectionId;
  appNavigationItems: NavigationItem[];
  settingsNavigationItems: NavigationItem[];
  settingsOpen: boolean;
  onAppNavigation: (id: AppSurfaceId) => void;
  onSettingsNavigation: (id: SettingsSectionId) => void;
  onOpenSettings: () => void;
  onCloseSettings: () => void;
}

// AppFrame owns only shell placement. Workflow state should stay in feature
// views and server-backed API clients.
export function AppFrame({
  activeSurfaceId,
  activeSettingsSectionId,
  appNavigationItems,
  settingsNavigationItems,
  settingsOpen,
  onAppNavigation,
  onSettingsNavigation,
  onOpenSettings,
  onCloseSettings,
  children,
}: PropsWithChildren<AppFrameProps>) {
  return (
    <div className="flex h-dvh bg-background font-sans text-foreground">
      <a className="sr-only focus:not-sr-only" href="#main-content">Skip to Main Content</a>
      <aside className="flex w-60 shrink-0 flex-col border-r bg-card" aria-label="Primary navigation">
        {settingsOpen ? (
          <SettingsNavigation
            activeItemId={activeSettingsSectionId}
            items={settingsNavigationItems}
            onBack={onCloseSettings}
            onSelect={onSettingsNavigation}
          />
        ) : (
          <AppNavigation
            activeItemId={activeSurfaceId}
            items={appNavigationItems}
            onOpenSettings={onOpenSettings}
            onSelect={onAppNavigation}
          />
        )}
      </aside>

      <main id="main-content" className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
