import {
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
} from '@web/components/ui/sidebar';
import type { ControlPlaneState } from '@web/api/client';
import { useI18n } from '@web/i18n';
import type { AppRoute } from '@web/layout/routes';
import type { AppSurfaceId } from '@web/layout/types';
import { MainNavigationSection } from './MainNavigationSection';
import { SidebarContentRegion } from './SidebarContentRegion';
import { SidebarSettingsEntry } from './SidebarSettingsEntry';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';

interface AppNavigationProps {
  activeItemId: AppSurfaceId;
  items: readonly AppRoute[];
  selectedWorkspaceId?: string;
  selectedSessionId?: string;
  selectedTaskId?: string;
  sessions: ControlPlaneState['sessions'];
  tasks: ControlPlaneState['heartbeat']['tasks'];
  workspaces: ControlPlaneState['workspaces'];
  onOpenSettings: () => void;
  onOpenWorkspaceSettings: () => void;
  onCreateSession: () => Promise<void>;
  onCreateTask: () => void;
  onRenameSession: (sessionId: string, name: string) => Promise<void>;
  onSetSessionArchived: (sessionId: string, archived: boolean) => Promise<void>;
  onSetSessionPinned: (sessionId: string, pinned: boolean) => Promise<void>;
  onSelectWorkspace: (workspaceId: string) => void;
  onSelectSession: (sessionId: string) => void;
  onSelectTask: (taskId: string) => void;
}

// AppNavigation owns the primary workbench sidebar mode: app surfaces, the
// future session list region, and the bottom settings entry point.
export function AppNavigation({
  activeItemId,
  items,
  selectedWorkspaceId,
  selectedSessionId,
  selectedTaskId,
  sessions,
  tasks,
  workspaces,
  onOpenSettings,
  onOpenWorkspaceSettings,
  onCreateSession,
  onCreateTask,
  onRenameSession,
  onSetSessionArchived,
  onSetSessionPinned,
  onSelectWorkspace,
  onSelectSession,
  onSelectTask,
}: AppNavigationProps) {
  const { t } = useI18n();

  return (
    <>
      <SidebarHeader className="v2-panel-divider border-b px-2 py-2">
        <div className="mb-1 flex h-6 items-center gap-2 px-1.5">
          <span className="v2-type-app-title text-foreground">Heddle</span>
        </div>
        <WorkspaceSwitcher
          selectedWorkspaceId={selectedWorkspaceId}
          workspaces={workspaces}
          onOpenWorkspaceSettings={onOpenWorkspaceSettings}
          onSelectWorkspace={onSelectWorkspace}
        />
      </SidebarHeader>
      <MainNavigationSection activeItemId={activeItemId} items={items} workspaceId={selectedWorkspaceId} />
      <SidebarContent>
        <SidebarContentRegion
          ariaLabel={activeItemId === 'tasks' ? t('navigation.taskListAriaLabel') : t('navigation.sessionListAriaLabel')}
          activeSurfaceId={activeItemId}
          selectedSessionId={selectedSessionId}
          selectedTaskId={selectedTaskId}
          sessionListTitle={t('navigation.sessionListTitle')}
          taskListTitle={t('navigation.taskListTitle')}
          sessions={sessions}
          tasks={tasks}
          onCreateSession={onCreateSession}
          onCreateTask={onCreateTask}
          onRenameSession={onRenameSession}
          onSetSessionArchived={onSetSessionArchived}
          onSetSessionPinned={onSetSessionPinned}
          onSelectSession={onSelectSession}
          onSelectTask={onSelectTask}
        />
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
