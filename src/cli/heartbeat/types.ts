import type { HeartbeatTaskStore } from '@/core/heartbeat/index.js';

export type HeartbeatCliOptions = {
  model?: string;
  maxSteps?: number;
  workspaceRoot?: string;
  stateDir?: string;
  searchIgnoreDirs?: string[];
  systemContext?: string;
};

export type HeartbeatCliStore = HeartbeatTaskStore;
