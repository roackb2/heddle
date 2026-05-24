import { Settings } from 'lucide-react';
import { SidebarMenuButton } from '@web/components/ui/sidebar';
import { useI18n } from '@web/i18n';

interface SettingsMenuProps {
  onOpenSettings: () => void;
}

// SettingsMenu is the compact sidebar entry for global controls. Keep only
// app-wide settings here; workflow-specific controls belong in their surface.
export function SettingsMenu({ onOpenSettings }: SettingsMenuProps) {
  const { t } = useI18n();

  return (
    <SidebarMenuButton onClick={onOpenSettings} tooltip={t('navigation.settings')}>
      <Settings aria-hidden="true" />
      <span>{t('navigation.settings')}</span>
    </SidebarMenuButton>
  );
}
