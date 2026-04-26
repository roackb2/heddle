import { useCallback, useState } from 'react';
import type { ControlPlaneState } from '../../../lib/api';
import type { ToastInput } from '../../../components/ui/use-toast';

export function useWorkspaceMutations({
  state,
  setActiveWorkspace,
  createWorkspace,
  renameWorkspace,
  notify,
}: {
  state?: ControlPlaneState;
  setActiveWorkspace: (workspaceId: string) => Promise<void>;
  createWorkspace: (input: { name: string; anchorRoot: string; setActive?: boolean }) => Promise<void>;
  renameWorkspace: (workspaceId: string, name: string) => Promise<void>;
  notify: (toast: ToastInput) => void;
}) {
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const [renamingWorkspaceId, setRenamingWorkspaceId] = useState<string | undefined>();

  const switchWorkspace = useCallback(async (workspaceId: string) => {
    try {
      await setActiveWorkspace(workspaceId);
      notify({
        title: 'Workspace switched',
        body: state?.workspaces.find((workspace) => workspace.id === workspaceId)?.name ?? workspaceId,
        tone: 'success',
      });
    } catch (switchError) {
      notify({
        title: 'Workspace switch failed',
        body: switchError instanceof Error ? switchError.message : String(switchError),
        tone: 'error',
      });
    }
  }, [notify, setActiveWorkspace, state?.workspaces]);

  const handleCreateWorkspace = useCallback(async (input: {
    name: string;
    anchorRoot: string;
    setActive: boolean;
  }) => {
    setCreatingWorkspace(true);
    try {
      await createWorkspace(input);
      notify({
        title: 'Workspace created',
        body: input.name,
        tone: 'success',
      });
    } catch (createError) {
      notify({
        title: 'Workspace creation failed',
        body: createError instanceof Error ? createError.message : String(createError),
        tone: 'error',
      });
    } finally {
      setCreatingWorkspace(false);
    }
  }, [createWorkspace, notify]);

  const handleRenameWorkspace = useCallback(async (workspaceId: string, name: string) => {
    setRenamingWorkspaceId(workspaceId);
    try {
      await renameWorkspace(workspaceId, name);
      notify({
        title: 'Workspace renamed',
        body: name,
        tone: 'success',
      });
    } catch (renameError) {
      notify({
        title: 'Workspace rename failed',
        body: renameError instanceof Error ? renameError.message : String(renameError),
        tone: 'error',
      });
    } finally {
      setRenamingWorkspaceId(undefined);
    }
  }, [notify, renameWorkspace]);

  return {
    creatingWorkspace,
    renamingWorkspaceId,
    switchWorkspace,
    createWorkspace: handleCreateWorkspace,
    renameWorkspace: handleRenameWorkspace,
  };
}
