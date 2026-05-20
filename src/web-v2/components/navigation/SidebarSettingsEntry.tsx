import { SettingsMenu } from './SettingsMenu';

interface SidebarSettingsEntryProps {
  onOpenSettings: () => void;
}

// SidebarSettingsEntry anchors app-wide settings at the bottom of the rail.
export function SidebarSettingsEntry({ onOpenSettings }: SidebarSettingsEntryProps) {
  return (
    <div className="v2-panel-divider border-t p-1.5">
      <SettingsMenu onOpenSettings={onOpenSettings} />
    </div>
  );
}
