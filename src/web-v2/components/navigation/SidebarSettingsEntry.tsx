import { SettingsMenu } from './SettingsMenu';

interface SidebarSettingsEntryProps {
  onOpenSettings: () => void;
}

// SidebarSettingsEntry anchors app-wide settings at the bottom of the rail.
export function SidebarSettingsEntry({ onOpenSettings }: SidebarSettingsEntryProps) {
  return (
    <SettingsMenu onOpenSettings={onOpenSettings} />
  );
}
