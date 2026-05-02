import type { ControlPlaneState } from '../../../../lib/api';

export type WorkspaceCreateInput = { name: string; anchorRoot: string; setActive: boolean };

export type WorkspaceListItem = ControlPlaneState['workspaces'][number] & {
  relation: 'attached' | 'known';
};
