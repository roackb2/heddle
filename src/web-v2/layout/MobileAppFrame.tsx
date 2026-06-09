import { useState } from 'react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@web/components/ui/sheet';
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

export function MobileAppFrame(props: AppFrameLayoutProps) {
  const {
    children,
    rightPanel,
    rightPanelAriaLabel,
    onOpenSettings,
    onCloseSettings,
    onCreateSession,
    onCreateTask,
    onRenameSession,
    onSetSessionPinned,
    onSelectSession,
    onSelectTask,
  } = props;
  const { t } = useI18n();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);

  async function createSession() {
    await onCreateSession();
    setSidebarOpen(false);
  }

  function selectSession(sessionId: string) {
    onSelectSession(sessionId);
    setSidebarOpen(false);
  }

  function selectTask(taskId: string) {
    onSelectTask(taskId);
    setSidebarOpen(false);
  }

  function createTask() {
    onCreateTask();
    setSidebarOpen(false);
  }

  function openSettings() {
    onOpenSettings();
    setSidebarOpen(false);
  }

  function closeSettings() {
    onCloseSettings();
    setSidebarOpen(false);
  }

  return (
    <>
      <AppFrameSkipLink />
      <div className="v2-mobile-shell relative h-full min-h-0 w-full max-w-[100dvw] overflow-hidden">
        <SidebarToggleButton collapsed={!sidebarOpen} onClick={() => setSidebarOpen(true)} />
        {rightPanel ? <InspectorToggleButton collapsed={!inspectorOpen} onClick={() => setInspectorOpen(true)} /> : null}
        <AppFrameWorkbench>{children}</AppFrameWorkbench>
      </div>

      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent
          side="left"
          className="v2-panel-divider w-[20rem] max-w-[86dvw] border-r bg-sidebar p-0 text-sidebar-foreground"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>{t('navigation.primaryAriaLabel')}</SheetTitle>
            <SheetDescription>{t('navigation.primaryAriaLabel')}</SheetDescription>
          </SheetHeader>
          <AppFrameSidebar
            {...props}
            onOpenSettings={openSettings}
            onCloseSettings={closeSettings}
            onCreateSession={createSession}
            onCreateTask={createTask}
            onRenameSession={onRenameSession}
            onSetSessionPinned={onSetSessionPinned}
            onSelectSession={selectSession}
            onSelectTask={selectTask}
          />
        </SheetContent>
      </Sheet>

      {rightPanel ? (
        <Sheet open={inspectorOpen} onOpenChange={setInspectorOpen}>
          <SheetContent
            side="right"
            className="v2-panel-divider w-[24rem] max-w-[92dvw] border-l bg-card p-0"
          >
            <SheetHeader className="sr-only">
              <SheetTitle>{rightPanelAriaLabel ?? t('inspector.contextAriaLabel')}</SheetTitle>
              <SheetDescription>{rightPanelAriaLabel ?? t('inspector.contextAriaLabel')}</SheetDescription>
            </SheetHeader>
            <AppFrameInspector ariaLabel={rightPanelAriaLabel ?? t('inspector.contextAriaLabel')}>
              {rightPanel}
            </AppFrameInspector>
          </SheetContent>
        </Sheet>
      ) : null}
    </>
  );
}
