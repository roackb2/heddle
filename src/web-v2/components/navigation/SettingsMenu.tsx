import { Button } from '../ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../ui/popover';
import { LanguageSelect } from './LanguageSelect';
import { useI18n } from '../../i18n';

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
        <Button className="h-8 w-full justify-start px-2" type="button" variant="ghost">
          {t('navigation.settings')}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-72"
        side="right"
        aria-label={t('navigation.settingsMenuAriaLabel')}
      >
        <div className="grid gap-4">
          <LanguageSelect />
          <Button className="h-8 justify-start px-2" onClick={onOpenSettings} type="button" variant="ghost">
            {t('navigation.openSettings')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
