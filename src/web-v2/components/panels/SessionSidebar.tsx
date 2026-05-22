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
  selectedSessionId?: string;
  sessions: ControlPlaneState['sessions'];
  tasks: ControlPlaneState['heartbeat']['tasks'];
  onOpenSettings: () => void;
  onCloseSettings: () => void;
  onCreateSession: () => Promise<void>;
  onSelectSession: (sessionId: string) => void;
}

// SessionSidebar owns the primary agent workbench rail: app navigation,
// settings navigation, and the future session list.
export function SessionSidebar({
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
}: SessionSidebarProps) {
  return (
    <div className="flex h-full min-w-0 flex-col text-sm">
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
          selectedSessionId={selectedSessionId}
          sessions={sessions}
          tasks={tasks}
          onOpenSettings={onOpenSettings}
          onCreateSession={onCreateSession}
          onSelectSession={onSelectSession}
        />
      )}
    </div>
  );
}
