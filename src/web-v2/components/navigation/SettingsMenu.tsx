import { Settings } from 'lucide-react';
import { Button } from '@web/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@web/components/ui/popover';
import { SidebarMenuButton } from '@web/components/ui/sidebar';
import { LanguageSelect } from './LanguageSelect';
import { useI18n } from '@web/i18n';

interface SettingsMenuProps {
  onOpenSettings: () => void;
}

// SettingsMenu is the compact sidebar entry for global controls. Keep only
// app-wide settings here; workflow-specific controls belong in their surface.
export function SettingsMenu({ onOpenSettings }: SettingsMenuProps) {
  const { t } = useI18n();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <SidebarMenuButton tooltip={t('navigation.settings')}>
          <Settings aria-hidden="true" />
          <span>{t('navigation.settings')}</span>
        </SidebarMenuButton>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-64 p-2"
        side="top"
        sideOffset={8}
        aria-label={t('navigation.settingsMenuAriaLabel')}
      >
        <div className="grid gap-2">
          <LanguageSelect />
          <Button
            className="v2-nav-row w-full"
            onClick={onOpenSettings}
            type="button"
            variant="ghost"
          >
            {t('navigation.openSettings')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
