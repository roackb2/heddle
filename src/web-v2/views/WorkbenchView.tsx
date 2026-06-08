import type { ComponentProps, ReactNode } from 'react';
import { ConversationThread } from '@web/components/conversation';
import { GeneralSettingsView, McpSettingsView, MemorySettingsView, SkillsSettingsView, WorkspaceSettingsView } from '@web/components/settings';
import type { I18nMessageKey } from '@web/i18n';
import { useI18n } from '@web/i18n';
import type { AppSurfaceId, SettingsSectionId } from '@web/layout/types';
import { TasksWorkbenchView } from './TasksWorkbenchView';

export type SessionWorkbenchViewProps = Omit<ComponentProps<typeof ConversationThread>, 'emptyTitle'>;
export type TaskWorkbenchViewProps = ComponentProps<typeof TasksWorkbenchView>;
export type MemorySettingsViewProps = ComponentProps<typeof MemorySettingsView>;
export type McpSettingsViewProps = ComponentProps<typeof McpSettingsView>;
export type SkillsSettingsViewProps = ComponentProps<typeof SkillsSettingsView>;
export type WorkspaceSettingsViewProps = ComponentProps<typeof WorkspaceSettingsView>;

interface WorkbenchViewProps {
  activeSurfaceId: AppSurfaceId;
  activeSettingsSectionId: SettingsSectionId;
  memorySettingsView: MemorySettingsViewProps;
  mcpSettingsView: McpSettingsViewProps;
  sessionView: SessionWorkbenchViewProps;
  settingsOpen: boolean;
  skillsSettingsView: SkillsSettingsViewProps;
  taskView: TaskWorkbenchViewProps;
  workspaceSettingsView: WorkspaceSettingsViewProps;
}

const appSurfaceLabelKeys = {
  sessions: 'surface.sessions',
  tasks: 'surface.tasks',
} satisfies Record<AppSurfaceId, I18nMessageKey>;

const settingsSectionLabelKeys = {
  general: 'settings.general',
  memory: 'settings.memory',
  mcp: 'settings.mcp',
  skills: 'settings.skills',
  workspaces: 'settings.workspaces',
} satisfies Record<SettingsSectionId, I18nMessageKey>;

// WorkbenchView renders the selected v2 surface while keeping data loading in
// shell-level hooks so route views stay presentational.
export function WorkbenchView({
  activeSurfaceId,
  activeSettingsSectionId,
  memorySettingsView,
  mcpSettingsView,
  sessionView,
  settingsOpen,
  skillsSettingsView,
  taskView,
  workspaceSettingsView,
}: WorkbenchViewProps) {
  const { t } = useI18n();
  const surfaceViews = {
    sessions: {
      title: sessionView.session?.name ?? t(appSurfaceLabelKeys.sessions),
      content: <ConversationThread emptyTitle={t('workbench.emptyConversation')} {...sessionView} />,
    },
    tasks: {
      title: taskView.task?.name ?? taskView.task?.task ?? t(appSurfaceLabelKeys.tasks),
      content: <TasksWorkbenchView {...taskView} />,
    },
  } satisfies Record<AppSurfaceId, { title: string; content: ReactNode }>;
  const settingsViews = {
    general: <GeneralSettingsView />,
    memory: <MemorySettingsView {...memorySettingsView} />,
    mcp: <McpSettingsView {...mcpSettingsView} />,
    skills: <SkillsSettingsView {...skillsSettingsView} />,
    workspaces: <WorkspaceSettingsView {...workspaceSettingsView} />,
  } satisfies Record<SettingsSectionId, ReactNode>;
  const activeSurface = surfaceViews[activeSurfaceId];
  const title = settingsOpen ? t(settingsSectionLabelKeys[activeSettingsSectionId]) : activeSurface.title;

  const testId =
    settingsOpen ? `web-v2-settings-${activeSettingsSectionId}` : `web-v2-surface-${activeSurfaceId}`;

  return (
    <section className="flex h-full min-w-0 flex-col bg-background" data-testid={testId}>
      <header className="v2-panel-header">
        <h1 className="v2-type-panel-title text-balance" data-testid="web-v2-workbench-title">{title}</h1>
      </header>
      <div
        className="min-h-0 flex-1 bg-background"
        aria-label={`${title} ${t('workbench.workspaceAriaLabel')}`}
        data-testid="web-v2-workbench-body"
      >
        {settingsOpen ? settingsViews[activeSettingsSectionId] : activeSurface.content}
      </div>
    </section>
  );
}
