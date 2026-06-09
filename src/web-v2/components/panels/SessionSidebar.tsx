import { AppNavigation, SettingsNavigation } from '@web/components/navigation';
import type { ControlPlaneState } from '@web/api/client';
import type { AppRoute, SettingsRoute } from '@web/layout/routes';
import type { AppSurfaceId, SettingsSectionId } from '@web/layout/types';

interface SessionSidebarProps {
  activeSurfaceId: AppSurfaceId;
  activeSettingsSectionId: SettingsSectionId;
  appNavigationItems: readonly AppRoute[];
  settingsNavigationItems: readonly SettingsRoute[];
  settingsOpen: boolean;
  selectedWorkspaceId?: string;
  selectedSessionId?: string;
  selectedTaskId?: string;
  sessions: ControlPlaneState['sessions'];
  tasks: ControlPlaneState['heartbeat']['tasks'];
  workspaces: ControlPlaneState['workspaces'];
  onOpenSettings: () => void;
  onOpenWorkspaceSettings: () => void;
  onCloseSettings: () => void;
  onCreateSession: () => Promise<void>;
  onCreateTask: () => void;
  onRenameSession: (sessionId: string, name: string) => Promise<void>;
  onSetSessionArchived: (sessionId: string, archived: boolean) => Promise<void>;
  onSetSessionPinned: (sessionId: string, pinned: boolean) => Promise<void>;
  onSelectWorkspace: (workspaceId: string) => void;
  onSelectSession: (sessionId: string) => void;
  onSelectTask: (taskId: string) => void;
}

// SessionSidebar owns the primary agent workbench rail: app navigation,
// settings navigation, and the future session list.
export function SessionSidebar({
  activeSurfaceId,
  activeSettingsSectionId,
  appNavigationItems,
  settingsNavigationItems,
  settingsOpen,
  selectedWorkspaceId,
  selectedSessionId,
  selectedTaskId,
  sessions,
  tasks,
  workspaces,
  onOpenSettings,
  onOpenWorkspaceSettings,
  onCloseSettings,
  onCreateSession,
  onCreateTask,
  onRenameSession,
  onSetSessionArchived,
  onSetSessionPinned,
  onSelectWorkspace,
  onSelectSession,
  onSelectTask,
}: SessionSidebarProps) {
  return (
    <div className="flex h-full min-w-0 flex-col">
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
          selectedWorkspaceId={selectedWorkspaceId}
          selectedSessionId={selectedSessionId}
          selectedTaskId={selectedTaskId}
          sessions={sessions}
          tasks={tasks}
          workspaces={workspaces}
          onOpenSettings={onOpenSettings}
          onOpenWorkspaceSettings={onOpenWorkspaceSettings}
          onCreateSession={onCreateSession}
          onCreateTask={onCreateTask}
          onRenameSession={onRenameSession}
          onSetSessionArchived={onSetSessionArchived}
          onSetSessionPinned={onSetSessionPinned}
          onSelectWorkspace={onSelectWorkspace}
          onSelectSession={onSelectSession}
          onSelectTask={onSelectTask}
        />
      )}
    </div>
  );
}
