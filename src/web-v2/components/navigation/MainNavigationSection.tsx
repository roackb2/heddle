import { SidebarGroup, SidebarGroupContent, SidebarMenu, SidebarMenuItem } from '@web/components/ui/sidebar';
import type { AppRoute } from '@web/layout/routes';
import type { AppSurfaceId } from '@web/layout/types';
import { useI18n } from '@web/i18n';
import { SidebarLink } from './SidebarLink';

interface MainNavigationSectionProps {
  activeItemId: AppSurfaceId;
  items: readonly AppRoute[];
  workspaceId?: string;
}

// MainNavigationSection owns the current top-level web-v2 routes. Do not add
// placeholder features here until the matching route and behavior exist.
export function MainNavigationSection({ activeItemId, items, workspaceId }: MainNavigationSectionProps) {
  const { t } = useI18n();

  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <nav aria-label={t('navigation.mainAriaLabel')}>
          <SidebarMenu>
            {items.map((item) => (
              <SidebarMenuItem key={item.id}>
                <SidebarLink
                  active={item.id === activeItemId}
                  href={workspaceId ? `/workspaces/${encodeURIComponent(workspaceId)}${item.href}` : item.href}
                  label={t(item.labelKey)}
                  surfaceId={item.id}
                />
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </nav>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
