import { ArrowLeft } from 'lucide-react';
import {
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@web/components/ui/sidebar';
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
      <SidebarHeader className="v2-panel-divider h-12 justify-center border-b px-2 py-0">
        <div className="flex items-center gap-2">
          <span className="v2-type-app-title text-foreground">{t('settings.general')}</span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup className="v2-panel-divider border-b">
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton onClick={onBack}>
                  <ArrowLeft aria-hidden="true" />
                  {t('navigation.backToApp')}
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupContent>
            <nav aria-label={t('navigation.settingsAriaLabel')}>
              <SidebarMenu>
                {items.map((item) => (
                  <SidebarMenuItem key={item.id}>
                    <SidebarLink
                      active={item.id === activeItemId}
                      href={item.href}
                      label={t(item.labelKey)}
                    />
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </nav>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </>
  );
}
