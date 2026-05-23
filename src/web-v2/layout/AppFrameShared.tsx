import type { PropsWithChildren } from 'react';
import type { LucideIcon } from 'lucide-react';
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-react';
import type { ControlPlaneState } from '@web/api/client';
import { ContextInspector, ConversationWorkspace, SessionSidebar } from '@web/components/panels';
import { Button } from '@web/components/ui/button';
import { useI18n } from '@web/i18n';
import type { AppRoute, SettingsRoute } from '@web/layout/routes';
import type { AppSurfaceId, SettingsSectionId } from '@web/layout/types';

export interface AppFrameProps {
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

export type AppFrameLayoutProps = PropsWithChildren<AppFrameProps>;

export function AppFrameSkipLink() {
  const { t } = useI18n();

  return <a className="sr-only focus:not-sr-only" href="#main-content">{t('navigation.skipToMain')}</a>;
}

export function AppFrameWorkbench({ children }: PropsWithChildren) {
  return <ConversationWorkspace>{children}</ConversationWorkspace>;
}

export function AppFrameSidebar({
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
}: AppFrameProps) {
  return (
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
  );
}

export function AppFrameInspector() {
  return <ContextInspector />;
}

export function SidebarToggleButton({
  collapsed,
  onClick,
}: {
  collapsed: boolean;
  onClick: () => void;
}) {
  return (
    <FrameToggleButton
      collapsed={collapsed}
      className="left-2"
      CollapsedIcon={PanelLeftOpen}
      ExpandedIcon={PanelLeftClose}
      collapsedLabelKey="navigation.expandSidebar"
      expandedLabelKey="navigation.collapseSidebar"
      onClick={onClick}
    />
  );
}

export function InspectorToggleButton({
  collapsed,
  onClick,
}: {
  collapsed: boolean;
  onClick: () => void;
}) {
  return (
    <FrameToggleButton
      collapsed={collapsed}
      className="right-2"
      CollapsedIcon={PanelRightOpen}
      ExpandedIcon={PanelRightClose}
      collapsedLabelKey="inspector.expandPanel"
      expandedLabelKey="inspector.collapsePanel"
      onClick={onClick}
    />
  );
}

function FrameToggleButton({
  collapsed,
  className,
  CollapsedIcon,
  ExpandedIcon,
  collapsedLabelKey,
  expandedLabelKey,
  onClick,
}: {
  collapsed: boolean;
  className: string;
  CollapsedIcon: LucideIcon;
  ExpandedIcon: LucideIcon;
  collapsedLabelKey: 'navigation.expandSidebar' | 'inspector.expandPanel';
  expandedLabelKey: 'navigation.collapseSidebar' | 'inspector.collapsePanel';
  onClick: () => void;
}) {
  const { t } = useI18n();
  const label = t(collapsed ? collapsedLabelKey : expandedLabelKey);
  const Icon = collapsed ? CollapsedIcon : ExpandedIcon;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-expanded={!collapsed}
      aria-label={label}
      className={`v2-icon-button absolute top-2 z-20 size-7 ${className}`}
      onClick={onClick}
    >
      <Icon aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </Button>
  );
}
