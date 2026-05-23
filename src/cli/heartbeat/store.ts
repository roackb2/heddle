import { FileHeartbeatTaskService } from '@/core/heartbeat/index.js';
import type { HeartbeatCliOptions, HeartbeatCliStore } from './types.js';

export function createHeartbeatCliStore(options: HeartbeatCliOptions): HeartbeatCliStore {
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  const stateDir = options.stateDir ?? '.heddle';
  return new FileHeartbeatTaskService({ workspaceRoot, stateDir });
}
