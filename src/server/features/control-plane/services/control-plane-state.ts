import { resolve } from 'node:path';
import type { HeddleServerContext } from '../../../types.js';
import type { ControlPlaneState } from '../types.js';
import { readChatSessionViews } from './chat-sessions.js';
import { listControlPlaneHeartbeatRuns, listControlPlaneHeartbeatTasks } from './heartbeat.js';

export async function loadControlPlaneState(context: HeddleServerContext): Promise<ControlPlaneState> {
  const [tasks, runs] = await Promise.all([
    listControlPlaneHeartbeatTasks(context.stateRoot),
    listControlPlaneHeartbeatRuns(context.stateRoot, { limit: 20 }),
  ]);

  return {
    workspaceRoot: context.workspaceRoot,
    stateRoot: context.stateRoot,
    sessions: readChatSessionViews(resolve(context.stateRoot, 'chat-sessions.catalog.json')),
    heartbeat: {
      tasks,
      runs,
    },
  };
}
