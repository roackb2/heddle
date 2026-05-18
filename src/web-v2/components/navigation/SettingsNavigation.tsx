import { Button } from '@web/components/ui/button';
import { useI18n } from '@web/i18n';
import type { NavigationItem, SettingsSectionId } from '@web/layout/types';
import { SidebarLink } from './SidebarLink';

interface SettingsNavigationProps {
  activeItemId: SettingsSectionId;
  items: readonly NavigationItem[];
  onBack: () => void;
}

// SettingsNavigation owns the alternate sidebar mode for configuration surfaces
// that should not crowd the main agent workbench.
export function SettingsNavigation({ activeItemId, items, onBack }: SettingsNavigationProps) {
  const { t } = useI18n();

  return (
    <>
      <div className="border-b p-2">
        <Button className="h-8 w-full justify-start px-2 text-muted-foreground" onClick={onBack} type="button" variant="ghost">
          {t('navigation.backToApp')}
        </Button>
      </div>
      <nav className="grid gap-1 p-2" aria-label={t('navigation.settingsAriaLabel')}>
        {items.map((item) => (
          <SidebarLink
            key={item.id}
            active={item.id === activeItemId}
            href={item.href}
            label={t(item.labelKey)}
          />
        ))}
      </nav>
    </>
  );
}
