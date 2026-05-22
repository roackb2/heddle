import type { PropsWithChildren } from 'react';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@web/components/ui/resizable';
import {
  Sidebar,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@web/components/ui/sidebar';
import type { ControlPlaneState } from '@web/api/client';
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
  selectedSessionId?: string;
  sessions: ControlPlaneState['sessions'];
  tasks: ControlPlaneState['heartbeat']['tasks'];
  onOpenSettings: () => void;
  onCloseSettings: () => void;
  onCreateSession: () => Promise<void>;
  onSelectSession: (sessionId: string) => void;
}

// AppFrame owns only shell placement. Workflow state should stay in feature
// views and server-backed API clients.
export function AppFrame({
  activeSurfaceId,
  activeSettingsSectionId,
  appNavigationItems,
  settingsNavigationItems,
  settingsOpen,
  selectedSessionId,
  sessions,
  tasks,
  onOpenSettings,
  onCloseSettings,
  onCreateSession,
  onSelectSession,
  children,
}: PropsWithChildren<AppFrameProps>) {
  const { t } = useI18n();

  return (
    <SidebarProvider className="v2-shell h-dvh bg-background font-sans text-foreground">
      <a className="sr-only focus:not-sr-only" href="#main-content">{t('navigation.skipToMain')}</a>
      <Sidebar
        aria-label={t('navigation.primaryAriaLabel')}
        className="v2-sidebar-panel v2-panel-divider"
        collapsible="offcanvas"
      >
        <SessionSidebar
          activeSurfaceId={activeSurfaceId}
          activeSettingsSectionId={activeSettingsSectionId}
          appNavigationItems={appNavigationItems}
          settingsNavigationItems={settingsNavigationItems}
          settingsOpen={settingsOpen}
          selectedSessionId={selectedSessionId}
          sessions={sessions}
          tasks={tasks}
          onOpenSettings={onOpenSettings}
          onCloseSettings={onCloseSettings}
          onCreateSession={onCreateSession}
          onSelectSession={onSelectSession}
        />
      </Sidebar>

      <SidebarInset>
        <SidebarTrigger
          className="absolute left-2 top-2 z-20"
        />
        <ResizablePanelGroup direction="horizontal">
          <ResizablePanel defaultSize="74%" minSize="32rem">
            <ConversationWorkspace>{children}</ConversationWorkspace>
          </ResizablePanel>

          <ResizableHandle />
          <ResizablePanel defaultSize="26%" minSize="14rem" maxSize="36rem">
            <ContextInspector />
          </ResizablePanel>
        </ResizablePanelGroup>
      </SidebarInset>
    </SidebarProvider>
  );
}
