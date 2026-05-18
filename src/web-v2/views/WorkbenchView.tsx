import type { I18nMessageKey } from '../i18n';
import { useI18n } from '../i18n';
import type { AppSurfaceId, SettingsSectionId } from '../layout/types';

interface WorkbenchViewProps {
  activeSurfaceId: AppSurfaceId;
  activeSettingsSectionId: SettingsSectionId;
  settingsOpen: boolean;
}

const appSurfaceLabelKeys = {
  sessions: 'surface.sessions',
  tasks: 'surface.tasks',
} satisfies Record<AppSurfaceId, I18nMessageKey>;

const settingsSectionLabelKeys = {
  general: 'settings.general',
  workspaces: 'settings.workspaces',
  memory: 'settings.memory',
} satisfies Record<SettingsSectionId, I18nMessageKey>;

// WorkbenchView keeps the first v2 pass structural. It names the selected
// surface while leaving workflow content and data loading to later slices.
export function WorkbenchView({ activeSurfaceId, activeSettingsSectionId, settingsOpen }: WorkbenchViewProps) {
  const { t } = useI18n();
  const title = t(settingsOpen ? settingsSectionLabelKeys[activeSettingsSectionId] : appSurfaceLabelKeys[activeSurfaceId]);

  return (
    <section className="flex h-full min-w-0 flex-col bg-background">
      <header className="flex h-12 items-center border-b bg-card px-4">
        <h1 className="text-balance text-sm font-medium">{title}</h1>
      </header>
      <div className="min-h-0 flex-1 bg-background" aria-label={`${title} ${t('workbench.workspaceAriaLabel')}`} />
    </section>
  );
}
