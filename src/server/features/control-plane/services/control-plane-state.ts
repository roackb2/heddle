import { resolve } from 'node:path';
import type { HeddleServerContext } from '../../../types.js';
import type { ControlPlaneState } from '../types.js';
import { readChatSessionViews } from './chat-sessions.js';
import { listControlPlaneHeartbeatRuns, listControlPlaneHeartbeatTasks } from './heartbeat.js';

export async function loadControlPlaneState(context: HeddleServerContext): Promise<ControlPlaneState> {
  const workspaceRoot = context.activeWorkspace.anchorRoot;
  const stateRoot = context.activeWorkspace.stateRoot;
  const [tasks, runs] = await Promise.all([
    listControlPlaneHeartbeatTasks(stateRoot),
    listControlPlaneHeartbeatRuns(stateRoot, { limit: 20 }),
  ]);

  return {
    workspaceRoot,
    stateRoot,
    activeWorkspaceId: context.activeWorkspaceId,
    workspace: context.activeWorkspace,
    workspaces: context.workspaces,
    runtimeHost: context.runtimeHost,
    sessions: readChatSessionViews(resolve(stateRoot, 'chat-sessions.catalog.json')),
    heartbeat: {
      tasks,
      runs,
    },
  };
}
