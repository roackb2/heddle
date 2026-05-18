import type { PropsWithChildren } from 'react';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '../components/ui/resizable';
import { AppNavigation, SettingsNavigation } from '../components/navigation';
import { useI18n } from '../i18n';
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
  const { t } = useI18n();

  return (
    <div className="h-dvh bg-background font-sans text-foreground">
      <a className="sr-only focus:not-sr-only" href="#main-content">{t('navigation.skipToMain')}</a>
      <ResizablePanelGroup direction="horizontal">
        <ResizablePanel defaultSize="16%" minSize="12rem" maxSize="28rem">
          <aside className="flex h-full min-w-0 flex-col bg-card" aria-label={t('navigation.primaryAriaLabel')}>
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
        </ResizablePanel>

        <ResizableHandle />
        <ResizablePanel defaultSize="62%" minSize="32rem">
          <main id="main-content" className="h-full min-w-0">{children}</main>
        </ResizablePanel>

        <ResizableHandle />
        <ResizablePanel defaultSize="22%" minSize="14rem" maxSize="36rem">
          <aside className="h-full min-w-0 bg-card" aria-label={t('inspector.contextAriaLabel')} />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
