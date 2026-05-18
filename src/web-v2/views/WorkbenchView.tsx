import type { AppSurfaceId, SettingsSectionId } from '../layout/types';

interface WorkbenchViewProps {
  activeSurfaceId: AppSurfaceId;
  activeSettingsSectionId: SettingsSectionId;
  settingsOpen: boolean;
}

const appSurfaceLabels: Record<AppSurfaceId, string> = {
  sessions: 'Sessions',
  tasks: 'Tasks',
};

const settingsSectionLabels: Record<SettingsSectionId, string> = {
  general: 'General',
  workspaces: 'Workspace Management',
  memory: 'Memory Status',
};

// WorkbenchView keeps the first v2 pass structural. It names the selected
// surface while leaving workflow content and data loading to later slices.
export function WorkbenchView({ activeSurfaceId, activeSettingsSectionId, settingsOpen }: WorkbenchViewProps) {
  const title = settingsOpen ? settingsSectionLabels[activeSettingsSectionId] : appSurfaceLabels[activeSurfaceId];

  return (
    <section className="flex h-dvh min-w-0 bg-background">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 items-center border-b bg-card px-4">
          <h1 className="text-balance text-sm font-medium">{title}</h1>
        </header>
        <div className="min-h-0 flex-1 bg-background" aria-label={`${title} workspace`} />
      </div>

      <aside className="w-80 shrink-0 border-l bg-card" aria-label="Context inspector" />
    </section>
  );
}
