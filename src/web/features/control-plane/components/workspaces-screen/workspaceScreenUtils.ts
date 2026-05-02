import type { ControlPlaneState } from '../../../../lib/api';
import type { WorkspaceListItem } from './types';

export function buildRecentWorkspaces(state: ControlPlaneState): WorkspaceListItem[] {
  const byStateRoot = new Map<string, WorkspaceListItem>();
  for (const workspace of state.workspaces) {
    byStateRoot.set(workspace.stateRoot, { ...workspace, relation: 'attached' });
  }
  for (const workspace of state.knownWorkspaces ?? []) {
    if (!byStateRoot.has(workspace.stateRoot)) {
      byStateRoot.set(workspace.stateRoot, { ...workspace, relation: 'known' });
    }
  }
  return Array.from(byStateRoot.values()).sort((left, right) => {
    const activeScore = Number(right.id === state.activeWorkspaceId) - Number(left.id === state.activeWorkspaceId);
    if (activeScore !== 0) {
      return activeScore;
    }
    return (right.updatedAt ?? '').localeCompare(left.updatedAt ?? '');
  });
}

export function workspaceNameFromPath(path: string): string {
  const normalized = path.trim().replace(/\/+$/, '');
  return normalized.split('/').filter(Boolean).at(-1) ?? normalized;
}
