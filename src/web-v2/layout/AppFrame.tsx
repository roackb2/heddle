import type { PropsWithChildren } from 'react';
import { useState } from 'react';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { usePanelRef } from 'react-resizable-panels';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@web/components/ui/resizable';
import { ContextInspector, ConversationWorkspace, SessionSidebar } from '@web/components/panels';
import { useI18n } from '@web/i18n';
import type { AppRoute, SettingsRoute } from '@web/layout/routes';
import type { AppSurfaceId, SettingsSectionId } from '@web/layout/types';

interface AppFrameProps {
  activeSurfaceId: AppSurfaceId;
  activeSettingsSectionId: SettingsSectionId;
  appNavigationItems: readonly AppRoute[];
  settingsNavigationItems: readonly SettingsRoute[];
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
  const sidebarPanelRef = usePanelRef();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  function toggleSidebar() {
    const panel = sidebarPanelRef.current;
    if (!panel) {
      return;
    }

    if (panel.isCollapsed()) {
      panel.expand();
      setSidebarCollapsed(false);
      return;
    }

    panel.collapse();
    setSidebarCollapsed(true);
  }

  const ToggleIcon = sidebarCollapsed ? PanelLeftOpen : PanelLeftClose;

  return (
    <div className="relative h-dvh bg-background font-sans text-foreground">
      <a className="sr-only focus:not-sr-only" href="#main-content">{t('navigation.skipToMain')}</a>
      <button
        aria-expanded={!sidebarCollapsed}
        aria-label={t(sidebarCollapsed ? 'navigation.expandSidebar' : 'navigation.collapseSidebar')}
        className="v2-icon-button absolute left-2 top-2 z-20 inline-flex items-center justify-center"
        onClick={toggleSidebar}
        type="button"
      >
        <ToggleIcon className="size-3.5" aria-hidden="true" />
      </button>
      <ResizablePanelGroup direction="horizontal">
        <ResizablePanel
          className="v2-sidebar-panel"
          collapsedSize="0px"
          collapsible
          defaultSize="16%"
          maxSize="28rem"
          minSize="12rem"
          onResize={() => setSidebarCollapsed(sidebarPanelRef.current?.isCollapsed() ?? false)}
          panelRef={sidebarPanelRef}
        >
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
