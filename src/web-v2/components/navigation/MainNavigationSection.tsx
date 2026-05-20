import type { AppRoute } from '@web/layout/routes';
import type { AppSurfaceId } from '@web/layout/types';
import { useI18n } from '@web/i18n';
import { SidebarLink } from './SidebarLink';

interface MainNavigationSectionProps {
  activeItemId: AppSurfaceId;
  items: readonly AppRoute[];
}

// MainNavigationSection owns the current top-level web-v2 routes. Do not add
// placeholder features here until the matching route and behavior exist.
export function MainNavigationSection({ activeItemId, items }: MainNavigationSectionProps) {
  const { t } = useI18n();

  return (
    <nav className="v2-sidebar-section" aria-label={t('navigation.mainAriaLabel')}>
      {items.map((item) => (
        <SidebarLink
          key={item.id}
          active={item.id === activeItemId}
          href={item.href}
          label={t(item.labelKey)}
          surfaceId={item.id}
        />
      ))}
    </nav>
  );
}
