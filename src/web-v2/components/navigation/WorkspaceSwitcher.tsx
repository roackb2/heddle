import { useState } from 'react';
import { Check, ChevronDown, Folder, Settings } from 'lucide-react';
import type { ControlPlaneState } from '@web/api/client';
import { Button } from '@web/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@web/components/ui/popover';
import { useI18n } from '@web/i18n';
import { cn } from '@web/lib/utils';

interface WorkspaceSwitcherProps {
  selectedWorkspaceId?: string;
  workspaces: ControlPlaneState['workspaces'];
  onOpenWorkspaceSettings: () => void;
  onSelectWorkspace: (workspaceId: string) => void;
}

export function WorkspaceSwitcher({
  selectedWorkspaceId,
  workspaces,
  onOpenWorkspaceSettings,
  onSelectWorkspace,
}: WorkspaceSwitcherProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const selectedWorkspace = workspaces.find((workspace) => workspace.id === selectedWorkspaceId);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="group flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-1.5 text-left text-sidebar-foreground outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-1 focus-visible:ring-sidebar-ring"
          aria-label={t('navigation.workspaceSwitcher')}
        >
          <Folder className="size-4 shrink-0 text-muted-foreground group-hover:text-sidebar-accent-foreground" aria-hidden="true" />
          <span className="v2-type-nav-primary min-w-0 flex-1 truncate">
            {selectedWorkspace?.name ?? selectedWorkspaceId ?? t('navigation.workspaceSwitcher')}
          </span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground group-hover:text-sidebar-accent-foreground" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={6}
        className="w-72 p-1.5"
      >
        <div className="px-2 py-1.5">
          <p className="v2-type-section-label text-muted-foreground">{t('navigation.switchWorkspace')}</p>
        </div>
        <div className="max-h-72 overflow-auto">
          {workspaces.length ? workspaces.map((workspace) => {
            const selected = workspace.id === selectedWorkspaceId;

            return (
              <button
                key={workspace.id}
                type="button"
                className={cn(
                  'group flex w-full min-w-0 items-start gap-2 rounded-md px-2 py-1.5 text-left outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-1 focus-visible:ring-ring',
                  selected && 'bg-accent text-accent-foreground',
                )}
                onClick={() => {
                  setOpen(false);
                  onSelectWorkspace(workspace.id);
                }}
              >
                <Check
                  className={cn(
                    'mt-0.5 size-3.5 shrink-0 text-transparent',
                    selected && 'text-accent-foreground',
                  )}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1">
                  <span className="v2-type-nav-primary block truncate">{workspace.name}</span>
                  <span className="v2-type-caption block truncate text-muted-foreground group-hover:text-accent-foreground/75">
                    {workspace.workspaceRoot}
                  </span>
                </span>
              </button>
            );
          }) : (
            <p className="v2-type-caption px-2 py-3 text-muted-foreground">{t('navigation.noWorkspaces')}</p>
          )}
        </div>
        <div className="mt-1 border-t border-border pt-1">
          <Button
            type="button"
            variant="ghost"
            size="none"
            className="h-8 w-full justify-start px-2"
            onClick={() => {
              setOpen(false);
              onOpenWorkspaceSettings();
            }}
          >
            <Settings aria-hidden="true" />
            <span>{t('navigation.manageWorkspaces')}</span>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
