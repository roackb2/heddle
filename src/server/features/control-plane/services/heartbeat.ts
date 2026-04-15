import { resolve } from 'node:path';
import {
  createFileHeartbeatTaskStore,
  listHeartbeatRunViews,
  listHeartbeatTaskViews,
} from '../../../../index.js';

export function createHeartbeatStore(stateRoot: string) {
  return createFileHeartbeatTaskStore({ dir: resolve(stateRoot, 'heartbeat') });
}

export async function listControlPlaneHeartbeatTasks(stateRoot: string) {
  return await listHeartbeatTaskViews(createHeartbeatStore(stateRoot));
}

export async function listControlPlaneHeartbeatRuns(
  stateRoot: string,
  options: { taskId?: string; limit?: number } = {},
) {
  return await listHeartbeatRunViews(createHeartbeatStore(stateRoot), options);
}
