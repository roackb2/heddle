import { Button } from '@web/components/ui/button';
import { useI18n } from '@web/i18n';
import type { SettingsRoute } from '@web/layout/routes';
import type { SettingsSectionId } from '@web/layout/types';
import { SidebarLink } from './SidebarLink';

interface SettingsNavigationProps {
  activeItemId: SettingsSectionId;
  items: readonly SettingsRoute[];
  onBack: () => void;
}

// SettingsNavigation owns the alternate sidebar mode for configuration surfaces
// that should not crowd the main agent workbench.
export function SettingsNavigation({ activeItemId, items, onBack }: SettingsNavigationProps) {
  const { t } = useI18n();

  return (
    <>
      <div className="border-b border-border/70 p-1.5">
        <Button
          className="h-7 w-full justify-start rounded-md px-2 text-sm font-normal text-muted-foreground hover:bg-accent/70 hover:text-foreground"
          onClick={onBack}
          type="button"
          variant="ghost"
        >
          {t('navigation.backToApp')}
        </Button>
      </div>
      <nav className="grid gap-0.5 p-1.5" aria-label={t('navigation.settingsAriaLabel')}>
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
