import { resolve } from 'node:path';
import { createFileHeartbeatTaskStore } from '../../index.js';
import type { HeartbeatCliOptions, HeartbeatCliStore } from './types.js';

export function createHeartbeatCliStore(options: HeartbeatCliOptions): HeartbeatCliStore {
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  const stateDir = options.stateDir ?? '.heddle';
  return createFileHeartbeatTaskStore({
    dir: resolve(workspaceRoot, stateDir, 'heartbeat'),
  });
}
