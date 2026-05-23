import { useRef, useState } from 'react';
import type { PanelImperativeHandle, PanelSize } from 'react-resizable-panels';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@web/components/ui/resizable';
import {
  Sidebar,
  SidebarInset,
  useSidebar,
} from '@web/components/ui/sidebar';
import {
  AppFrameInspector,
  AppFrameSidebar,
  AppFrameSkipLink,
  AppFrameWorkbench,
  InspectorToggleButton,
  SidebarToggleButton,
  type AppFrameLayoutProps,
} from '@web/layout/AppFrameShared';
import { useI18n } from '@web/i18n';

export function DesktopAppFrame(props: AppFrameLayoutProps) {
  const { children } = props;
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
      <AppFrameSkipLink />
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
            <AppFrameSidebar {...props} />
          </Sidebar>
        </ResizablePanel>

        <ResizableHandle />

        <ResizablePanel className="h-full min-h-0 overflow-hidden" defaultSize="58%" minSize="32rem">
          <SidebarInset className="h-full min-h-0 overflow-hidden">
            <SidebarToggleButton collapsed={sidebarCollapsed} onClick={toggleSidebarPanel} />
            <InspectorToggleButton collapsed={inspectorCollapsed} onClick={toggleInspectorPanel} />
            <AppFrameWorkbench>{children}</AppFrameWorkbench>
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
          <AppFrameInspector />
        </ResizablePanel>
      </ResizablePanelGroup>
    </>
  );
}
