import { useMemo, useState, type ReactNode } from 'react';
import { Check, Copy, FolderPlus } from 'lucide-react';
import type { ControlPlaneState } from '@web/api/client';
import { Button } from '@web/components/ui/button';
import { Input } from '@web/components/ui/input';
import { Switch } from '@web/components/ui/switch';
import { useI18n } from '@web/i18n';

type Workspace = ControlPlaneState['workspaces'][number];

export type WorkspaceCreateInput = {
  name: string;
  workspaceRoot: string;
  setActive: boolean;
};

export interface WorkspaceSettingsViewProps {
  state?: ControlPlaneState;
  selectedWorkspaceId?: string;
  loading: boolean;
  error?: string;
  updating: boolean;
  onCreateWorkspace: (input: WorkspaceCreateInput) => Promise<void>;
  onRenameWorkspace: (workspaceId: string, name: string) => Promise<void>;
  onSwitchWorkspace: (workspaceId: string) => Promise<void>;
}

export function WorkspaceSettingsView({
  state,
  selectedWorkspaceId,
  loading,
  error,
  updating,
  onCreateWorkspace,
  onRenameWorkspace,
  onSwitchWorkspace,
}: WorkspaceSettingsViewProps) {
  const { t } = useI18n();
  const [copiedPath, setCopiedPath] = useState<string | undefined>();
  const [editingWorkspaceId, setEditingWorkspaceId] = useState<string | undefined>();
  const [editingName, setEditingName] = useState('');
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [newWorkspaceRoot, setNewWorkspaceRoot] = useState('');
  const [switchAfterAdding, setSwitchAfterAdding] = useState(true);
  const [actionError, setActionError] = useState<string | undefined>();

  const workspaces = useMemo(() => state?.workspaces ?? [], [state?.workspaces]);
  const selectedWorkspace = workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? state?.workspace;
  const attachedStateRoots = useMemo(() => new Set(workspaces.map((workspace) => workspace.stateRoot)), [workspaces]);
  const knownWorkspaces = useMemo(
    () => (state?.knownWorkspaces ?? []).filter((workspace) => !attachedStateRoots.has(workspace.stateRoot)),
    [attachedStateRoots, state?.knownWorkspaces],
  );
  const newWorkspaceStateRoot = newWorkspaceRoot.trim() ? `${newWorkspaceRoot.trim().replace(/\/+$/, '')}/.heddle` : '';

  async function copyPath(path: string) {
    setActionError(undefined);
    try {
      await navigator.clipboard.writeText(path);
      setCopiedPath(path);
    } catch (copyError) {
      setActionError(copyError instanceof Error ? copyError.message : String(copyError));
    }
  }

  function startRename(workspace: Workspace) {
    setActionError(undefined);
    setEditingWorkspaceId(workspace.id);
    setEditingName(workspace.name);
  }

  async function saveRename(workspaceId: string) {
    const name = editingName.trim();
    if (!name) {
      setActionError(t('workspaceSettings.nameRequired'));
      return;
    }

    try {
      setActionError(undefined);
      await onRenameWorkspace(workspaceId, name);
      setEditingWorkspaceId(undefined);
      setEditingName('');
    } catch (renameError) {
      setActionError(renameError instanceof Error ? renameError.message : String(renameError));
    }
  }

  async function createWorkspace() {
    const workspaceRoot = newWorkspaceRoot.trim();
    if (!workspaceRoot) {
      setActionError(t('workspaceSettings.pathRequired'));
      return;
    }

    try {
      setActionError(undefined);
      await onCreateWorkspace({
        name: newWorkspaceName.trim() || workspaceRoot.split('/').filter(Boolean).at(-1) || t('workspaceSettings.defaultWorkspaceName'),
        workspaceRoot,
        setActive: switchAfterAdding,
      });
      setNewWorkspaceName('');
      setNewWorkspaceRoot('');
      setSwitchAfterAdding(true);
    } catch (createError) {
      setActionError(createError instanceof Error ? createError.message : String(createError));
    }
  }

  async function addKnownWorkspace(workspace: Workspace) {
    try {
      setActionError(undefined);
      await onCreateWorkspace({
        name: workspace.name,
        workspaceRoot: workspace.workspaceRoot,
        setActive: true,
      });
    } catch (knownError) {
      setActionError(knownError instanceof Error ? knownError.message : String(knownError));
    }
  }

  async function switchWorkspace(workspaceId: string) {
    try {
      setActionError(undefined);
      await onSwitchWorkspace(workspaceId);
    } catch (switchError) {
      setActionError(switchError instanceof Error ? switchError.message : String(switchError));
    }
  }

  if (loading && !state) {
    return <WorkspaceSettingsEmpty title={t('workspaceSettings.loadingTitle')} body={t('workspaceSettings.loadingBody')} />;
  }

  if (error && !state) {
    return <WorkspaceSettingsEmpty title={t('workspaceSettings.errorTitle')} body={error} />;
  }

  return (
    <div className="v2-scrollbar-hidden h-full min-w-0 overflow-auto">
      <div className="v2-settings-page mx-auto flex w-full max-w-3xl flex-col gap-6 px-8 py-8">
        {actionError ? <WorkspaceSettingsAlert message={actionError} /> : null}

        <section className="min-w-0">
          <h2 className="v2-type-section-label mb-3 text-muted-foreground">{t('workspaceSettings.currentTitle')}</h2>
          <div className="v2-settings-group">
            <WorkspaceInfoRow
              action={selectedWorkspace ? <StatusPill>{t('workspaceSettings.viewing')}</StatusPill> : null}
              label={t('workspaceSettings.name')}
              value={selectedWorkspace?.name ?? t('workspaceSettings.noWorkspace')}
            />
            <WorkspacePathRow
              copied={copiedPath === selectedWorkspace?.workspaceRoot}
              label={t('workspaceSettings.workspaceRoot')}
              path={selectedWorkspace?.workspaceRoot}
              onCopy={copyPath}
            />
            <WorkspacePathRow
              copied={copiedPath === selectedWorkspace?.stateRoot}
              label={t('workspaceSettings.stateRoot')}
              path={selectedWorkspace?.stateRoot}
              onCopy={copyPath}
            />
          </div>
        </section>

        <section className="min-w-0">
          <h2 className="v2-type-section-label mb-3 text-muted-foreground">{t('workspaceSettings.attachedTitle')}</h2>
          <div className="v2-settings-group">
            {workspaces.length ? workspaces.map((workspace) => {
              const selected = workspace.id === selectedWorkspace?.id;
              const editing = editingWorkspaceId === workspace.id;

              return (
                <div className="v2-settings-row" key={workspace.id}>
                  <div className="min-w-0">
                    {editing ? (
                      <Input
                        aria-label={t('workspaceSettings.name')}
                        className="v2-control h-8"
                        disabled={updating}
                        value={editingName}
                        onChange={(event) => setEditingName(event.target.value)}
                      />
                    ) : (
                      <>
                        <div className="flex min-w-0 items-center gap-2">
                          <p className="v2-type-nav-primary min-w-0 truncate text-foreground">{workspace.name}</p>
                          {selected ? <StatusPill>{t('workspaceSettings.viewing')}</StatusPill> : null}
                        </div>
                        <p className="v2-type-caption mt-1 truncate text-muted-foreground">{workspace.workspaceRoot}</p>
                      </>
                    )}
                  </div>
                  <div className="flex min-w-0 flex-wrap justify-end gap-2">
                    {editing ? (
                      <>
                        <Button type="button" variant="ghost" size="sm" disabled={updating} onClick={() => setEditingWorkspaceId(undefined)}>
                          {t('workspaceSettings.cancel')}
                        </Button>
                        <Button type="button" variant="outline" size="sm" disabled={updating} onClick={() => void saveRename(workspace.id)}>
                          {t('workspaceSettings.save')}
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button type="button" variant="ghost" size="sm" disabled={updating} onClick={() => startRename(workspace)}>
                          {t('workspaceSettings.rename')}
                        </Button>
                        <Button type="button" variant="outline" size="sm" disabled={updating || selected} onClick={() => void switchWorkspace(workspace.id)}>
                          {selected ? t('workspaceSettings.currentWorkspace') : t('workspaceSettings.switch')}
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              );
            }) : (
              <WorkspaceInfoRow label={t('workspaceSettings.attachedTitle')} value={t('workspaceSettings.noWorkspace')} />
            )}
          </div>
        </section>

        <section className="min-w-0">
          <h2 className="v2-type-section-label mb-3 text-muted-foreground">{t('workspaceSettings.addTitle')}</h2>
          <div className="v2-settings-group">
            <div className="v2-settings-row">
              <div className="min-w-0">
                <p className="v2-type-nav-primary text-foreground">{t('workspaceSettings.workspaceRoot')}</p>
                <p className="v2-type-caption mt-1 text-pretty text-muted-foreground">
                  {newWorkspaceStateRoot ? t('workspaceSettings.stateWillLiveAt').replace('{path}', newWorkspaceStateRoot) : t('workspaceSettings.addDetail')}
                </p>
              </div>
              <Input
                aria-label={t('workspaceSettings.workspaceRoot')}
                className="v2-control"
                disabled={updating}
                placeholder={t('workspaceSettings.pathPlaceholder')}
                value={newWorkspaceRoot}
                onChange={(event) => setNewWorkspaceRoot(event.target.value)}
              />
            </div>
            <div className="v2-settings-row">
              <div className="min-w-0">
                <p className="v2-type-nav-primary text-foreground">{t('workspaceSettings.name')}</p>
                <p className="v2-type-caption mt-1 text-muted-foreground">{t('workspaceSettings.nameDetail')}</p>
              </div>
              <Input
                aria-label={t('workspaceSettings.name')}
                className="v2-control"
                disabled={updating}
                placeholder={t('workspaceSettings.namePlaceholder')}
                value={newWorkspaceName}
                onChange={(event) => setNewWorkspaceName(event.target.value)}
              />
            </div>
            <div className="v2-settings-row">
              <div className="min-w-0">
                <p className="v2-type-nav-primary text-foreground">{t('workspaceSettings.switchAfterAdding')}</p>
                <p className="v2-type-caption mt-1 text-muted-foreground">{t('workspaceSettings.switchAfterAddingDetail')}</p>
              </div>
              <div className="flex min-w-0 justify-end">
                <Switch
                  aria-label={t('workspaceSettings.switchAfterAdding')}
                  checked={switchAfterAdding}
                  disabled={updating}
                  onCheckedChange={setSwitchAfterAdding}
                />
              </div>
            </div>
            <div className="v2-settings-row">
              <div className="min-w-0">
                <p className="v2-type-nav-primary text-foreground">{t('workspaceSettings.createAction')}</p>
                <p className="v2-type-caption mt-1 text-muted-foreground">{t('workspaceSettings.createDetail')}</p>
              </div>
              <div className="flex min-w-0 justify-end">
                <Button type="button" size="sm" disabled={updating || !newWorkspaceRoot.trim()} onClick={() => void createWorkspace()}>
                  <FolderPlus aria-hidden="true" />
                  <span>{t('workspaceSettings.createAction')}</span>
                </Button>
              </div>
            </div>
          </div>
        </section>

        {knownWorkspaces.length ? (
          <section className="min-w-0">
            <h2 className="v2-type-section-label mb-3 text-muted-foreground">{t('workspaceSettings.knownTitle')}</h2>
            <div className="v2-settings-group">
              {knownWorkspaces.map((workspace) => (
                <div className="v2-settings-row" key={workspace.stateRoot}>
                  <div className="min-w-0">
                    <p className="v2-type-nav-primary truncate text-foreground">{workspace.name}</p>
                    <p className="v2-type-caption mt-1 truncate text-muted-foreground">{workspace.workspaceRoot}</p>
                  </div>
                  <div className="flex min-w-0 justify-end">
                    <Button type="button" variant="outline" size="sm" disabled={updating} onClick={() => void addKnownWorkspace(workspace)}>
                      {t('workspaceSettings.addKnown')}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}

function WorkspaceInfoRow({
  action,
  label,
  value,
}: {
  action?: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="v2-settings-row">
      <div className="v2-type-nav-primary min-w-0 text-foreground">{label}</div>
      <div className="flex min-w-0 items-center justify-end gap-2 text-right">
        <span className="v2-type-body-strong min-w-0 truncate text-foreground">{value}</span>
        {action}
      </div>
    </div>
  );
}

function WorkspacePathRow({
  copied,
  label,
  path,
  onCopy,
}: {
  copied: boolean;
  label: string;
  path?: string;
  onCopy: (path: string) => void;
}) {
  const { t } = useI18n();

  return (
    <div className="v2-settings-row">
      <div className="v2-type-nav-primary min-w-0 text-foreground">{label}</div>
      <div className="flex min-w-0 items-center justify-end gap-2 text-right">
        <code className="v2-type-code min-w-0 truncate text-muted-foreground">{path ?? t('workspaceSettings.noWorkspace')}</code>
        {path ? (
          <Button type="button" variant="ghost" size="sm" className="shrink-0" onClick={() => onCopy(path)}>
            {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
            <span>{copied ? t('workspaceSettings.copied') : t('workspaceSettings.copy')}</span>
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function StatusPill({ children }: { children: ReactNode }) {
  return (
    <span className="v2-type-caption shrink-0 rounded-sm border border-primary/35 bg-primary/10 px-1.5 py-0.5 text-foreground">
      {children}
    </span>
  );
}

function WorkspaceSettingsAlert({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-destructive/45 bg-destructive/10 px-3 py-2">
      <p className="v2-type-caption text-pretty text-destructive">{message}</p>
    </div>
  );
}

function WorkspaceSettingsEmpty({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex h-full min-h-0 items-center justify-center px-6">
      <div className="max-w-sm text-center">
        <p className="v2-type-body-strong text-foreground">{title}</p>
        <p className="v2-type-panel-subtitle mt-1 text-pretty text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}
