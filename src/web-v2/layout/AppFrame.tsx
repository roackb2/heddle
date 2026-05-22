import { useRef, useState, type PropsWithChildren } from 'react';
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-react';
import type { PanelImperativeHandle, PanelSize } from 'react-resizable-panels';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@web/components/ui/resizable';
import {
  Sidebar,
  SidebarInset,
  SidebarProvider,
  useSidebar,
} from '@web/components/ui/sidebar';
import type { ControlPlaneState } from '@web/api/client';
import { Button } from '@web/components/ui/button';
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
  return (
    <SidebarProvider className="v2-shell h-dvh overflow-hidden bg-background font-sans text-foreground">
      <AppFramePanels
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
      >
        {children}
      </AppFramePanels>
    </SidebarProvider>
  );
}

function AppFramePanels({
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
  const { setOpen: setSidebarOpen } = useSidebar();
  const sidebarPanelRef = useRef<PanelImperativeHandle | null>(null);
  const inspectorPanelRef = useRef<PanelImperativeHandle | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);

  function toggleSidebarPanel() {
    if (sidebarCollapsed) {
      sidebarPanelRef.current?.expand();
      setSidebarOpen(true);
      setSidebarCollapsed(false);
      return;
    }

    sidebarPanelRef.current?.collapse();
    setSidebarOpen(false);
    setSidebarCollapsed(true);
  }

  function toggleInspectorPanel() {
    if (inspectorCollapsed) {
      inspectorPanelRef.current?.expand();
      setInspectorCollapsed(false);
      return;
    }

    inspectorPanelRef.current?.collapse();
    setInspectorCollapsed(true);
  }

  function syncSidebarCollapsed(panelSize: PanelSize) {
    const collapsed = panelSize.asPercentage <= 1;
    setSidebarCollapsed((previous) => {
      if (previous !== collapsed) {
        setSidebarOpen(!collapsed);
      }

      return collapsed;
    });
  }

  function syncInspectorCollapsed(panelSize: PanelSize) {
    setInspectorCollapsed(panelSize.asPercentage <= 1);
  }

  return (
    <>
      <a className="sr-only focus:not-sr-only" href="#main-content">{t('navigation.skipToMain')}</a>
      <ResizablePanelGroup className="min-h-0 overflow-hidden" direction="horizontal">
        <ResizablePanel
          collapsible
          className="h-full min-h-0 overflow-hidden"
          collapsedSize={0}
          defaultSize="17rem"
          minSize="14rem"
          maxSize="24rem"
          panelRef={sidebarPanelRef}
          onResize={syncSidebarCollapsed}
        >
          <Sidebar
            aria-label={t('navigation.primaryAriaLabel')}
            className="v2-sidebar-panel v2-panel-divider w-full"
            collapsible="none"
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
        </ResizablePanel>

        <ResizableHandle />

        <ResizablePanel className="h-full min-h-0 overflow-hidden" defaultSize="58%" minSize="32rem">
          <SidebarInset className="h-full min-h-0 overflow-hidden">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-expanded={!sidebarCollapsed}
              aria-label={t(sidebarCollapsed ? 'navigation.expandSidebar' : 'navigation.collapseSidebar')}
              className="v2-icon-button absolute left-2 top-2 z-20 size-7"
              onClick={toggleSidebarPanel}
            >
              {sidebarCollapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
              <span className="sr-only">{t(sidebarCollapsed ? 'navigation.expandSidebar' : 'navigation.collapseSidebar')}</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-expanded={!inspectorCollapsed}
              aria-label={t(inspectorCollapsed ? 'inspector.expandPanel' : 'inspector.collapsePanel')}
              className="v2-icon-button absolute right-2 top-2 z-20 size-7"
              onClick={toggleInspectorPanel}
            >
              {inspectorCollapsed ? <PanelRightOpen aria-hidden="true" /> : <PanelRightClose aria-hidden="true" />}
              <span className="sr-only">{t(inspectorCollapsed ? 'inspector.expandPanel' : 'inspector.collapsePanel')}</span>
            </Button>
            <ConversationWorkspace>{children}</ConversationWorkspace>
          </SidebarInset>
        </ResizablePanel>

        <ResizableHandle />

        <ResizablePanel
          collapsible
          className="h-full min-h-0 overflow-hidden"
          collapsedSize={0}
          defaultSize="22rem"
          minSize="14rem"
          maxSize="36rem"
          panelRef={inspectorPanelRef}
          onResize={syncInspectorCollapsed}
        >
          <ContextInspector />
        </ResizablePanel>
      </ResizablePanelGroup>
    </>
  );
}
