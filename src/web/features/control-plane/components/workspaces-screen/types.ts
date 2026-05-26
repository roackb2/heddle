import type { ControlPlaneState } from '../../../../lib/api';

export type WorkspaceCreateInput = { name: string; workspaceRoot: string; setActive: boolean };

export type WorkspaceListItem = ControlPlaneState['workspaces'][number] & {
  relation: 'attached' | 'known';
};
