import type { PropsWithChildren } from 'react';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@web/components/ui/resizable';
import { ContextInspector, ConversationWorkspace, SessionSidebar } from '@web/components/panels';
import { useI18n } from '@web/i18n';
import type { AppSurfaceId, NavigationItem, SettingsSectionId } from '@web/layout/types';

interface AppFrameProps {
  activeSurfaceId: AppSurfaceId;
  activeSettingsSectionId: SettingsSectionId;
  appNavigationItems: readonly NavigationItem[];
  settingsNavigationItems: readonly NavigationItem[];
  settingsOpen: boolean;
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
          <SessionSidebar
            activeSurfaceId={activeSurfaceId}
            activeSettingsSectionId={activeSettingsSectionId}
            appNavigationItems={appNavigationItems}
            settingsNavigationItems={settingsNavigationItems}
            settingsOpen={settingsOpen}
            onOpenSettings={onOpenSettings}
            onCloseSettings={onCloseSettings}
          />
        </ResizablePanel>

        <ResizableHandle />
        <ResizablePanel defaultSize="62%" minSize="32rem">
          <ConversationWorkspace>{children}</ConversationWorkspace>
        </ResizablePanel>

        <ResizableHandle />
        <ResizablePanel defaultSize="22%" minSize="14rem" maxSize="36rem">
          <ContextInspector />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
