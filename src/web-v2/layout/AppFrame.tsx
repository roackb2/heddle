import type { PropsWithChildren } from 'react';
import { Button } from '@/web/components/ui/button';
import { cn } from '@/web/lib/utils';
import type { AppSurfaceId, NavigationItem, SettingsSectionId } from './types';

interface AppFrameProps {
  activeSurfaceId: AppSurfaceId;
  activeSettingsSectionId: SettingsSectionId;
  appNavigationItems: NavigationItem[];
  settingsNavigationItems: NavigationItem[];
  settingsOpen: boolean;
  onAppNavigation: (id: AppSurfaceId) => void;
  onSettingsNavigation: (id: SettingsSectionId) => void;
  onOpenSettings: () => void;
  onCloseSettings: () => void;
}

// AppFrame owns only shell placement. Workflow state should stay in feature
// views and server-backed API clients.
export function AppFrame({
  activeSurfaceId,
  activeSettingsSectionId,
  appNavigationItems,
  settingsNavigationItems,
  settingsOpen,
  onAppNavigation,
  onSettingsNavigation,
  onOpenSettings,
  onCloseSettings,
  children,
}: PropsWithChildren<AppFrameProps>) {
  return (
    <div className="flex h-dvh bg-background font-sans text-foreground">
      <a className="sr-only focus:not-sr-only" href="#main-content">Skip to Main Content</a>
      <aside className="flex w-60 shrink-0 flex-col border-r bg-card" aria-label="Primary navigation">
        {settingsOpen ? (
          <SettingsNavigation
            activeItemId={activeSettingsSectionId}
            items={settingsNavigationItems}
            onBack={onCloseSettings}
            onSelect={onSettingsNavigation}
          />
        ) : (
          <AppNavigation
            activeItemId={activeSurfaceId}
            items={appNavigationItems}
            onOpenSettings={onOpenSettings}
            onSelect={onAppNavigation}
          />
        )}
      </aside>

      <main id="main-content" className="min-w-0 flex-1">{children}</main>
    </div>
  );
}

function AppNavigation({
  activeItemId,
  items,
  onOpenSettings,
  onSelect,
}: {
  activeItemId: AppSurfaceId;
  items: NavigationItem[];
  onOpenSettings: () => void;
  onSelect: (id: AppSurfaceId) => void;
}) {
  return (
    <>
      <div className="border-b px-3 py-2 text-sm font-medium text-foreground">Heddle</div>
      <nav className="grid gap-1 p-2" aria-label="Main app navigation">
        {items.map((item) => (
          <SidebarLink
            key={item.id}
            active={item.id === activeItemId}
            href={item.href}
            label={item.label}
            onClick={() => onSelect(item.id as AppSurfaceId)}
          />
        ))}
      </nav>
      <div className="min-h-0 flex-1 border-t bg-background" aria-label="Session list" />
      <div className="border-t p-2">
        <Button className="h-8 w-full justify-start px-2" onClick={onOpenSettings} type="button" variant="ghost">
          Settings
        </Button>
      </div>
    </>
  );
}

function SettingsNavigation({
  activeItemId,
  items,
  onBack,
  onSelect,
}: {
  activeItemId: SettingsSectionId;
  items: NavigationItem[];
  onBack: () => void;
  onSelect: (id: SettingsSectionId) => void;
}) {
  return (
    <>
      <div className="border-b p-2">
        <Button className="h-8 w-full justify-start px-2 text-muted-foreground" onClick={onBack} type="button" variant="ghost">
          Back to App
        </Button>
      </div>
      <nav className="grid gap-1 p-2" aria-label="Settings navigation">
        {items.map((item) => (
          <SidebarLink
            key={item.id}
            active={item.id === activeItemId}
            href={item.href}
            label={item.label}
            onClick={() => onSelect(item.id as SettingsSectionId)}
          />
        ))}
      </nav>
    </>
  );
}

function SidebarLink({
  active,
  href,
  label,
  onClick,
}: {
  active: boolean;
  href: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      className={cn('h-8 justify-start px-2 text-muted-foreground', active && 'bg-accent text-accent-foreground')}
      asChild
      variant="ghost"
    >
      <a
        aria-current={active ? 'page' : undefined}
        href={href}
        onClick={() => {
          onClick();
        }}
      >
        {label}
      </a>
    </Button>
  );
}
