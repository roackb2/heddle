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

interface AppNavigationProps {
  activeItemId: AppSurfaceId;
  items: readonly AppRoute[];
  selectedSessionId?: string;
  sessions: ControlPlaneState['sessions'];
  tasks: ControlPlaneState['heartbeat']['tasks'];
  onOpenSettings: () => void;
  onCreateSession: () => Promise<void>;
  onSelectSession: (sessionId: string) => void;
}

// AppNavigation owns the primary workbench sidebar mode: app surfaces, the
// future session list region, and the bottom settings entry point.
export function AppNavigation({
  activeItemId,
  items,
  selectedSessionId,
  sessions,
  tasks,
  onOpenSettings,
  onCreateSession,
  onSelectSession,
}: AppNavigationProps) {
  const { t } = useI18n();

  return (
    <>
      <SidebarHeader className="v2-panel-divider h-12 justify-center border-b px-2 py-0">
        <div className="flex items-center gap-2">
          <span className="v2-type-app-title text-foreground">Heddle</span>
        </div>
      </SidebarHeader>
      <MainNavigationSection activeItemId={activeItemId} items={items} />
      <SidebarContent>
        <SidebarContentRegion
          ariaLabel={activeItemId === 'tasks' ? t('navigation.taskListAriaLabel') : t('navigation.sessionListAriaLabel')}
          activeSurfaceId={activeItemId}
          selectedSessionId={selectedSessionId}
          sessionListTitle={t('navigation.sessionListTitle')}
          taskListTitle={t('navigation.taskListTitle')}
          sessions={sessions}
          tasks={tasks}
          onCreateSession={onCreateSession}
          onSelectSession={onSelectSession}
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
