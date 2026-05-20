import { SettingsMenu } from './SettingsMenu';

interface SidebarSettingsEntryProps {
  onOpenSettings: () => void;
}

// SidebarSettingsEntry anchors app-wide settings at the bottom of the rail.
export function SidebarSettingsEntry({ onOpenSettings }: SidebarSettingsEntryProps) {
  return (
    <div className="border-t border-border/70 p-1.5">
      <SettingsMenu onOpenSettings={onOpenSettings} />
    </div>
  );
}
