import type { HeartbeatTaskStore } from '../../index.js';

export type HeartbeatCliOptions = {
  model?: string;
  maxSteps?: number;
  workspaceRoot?: string;
  stateDir?: string;
  searchIgnoreDirs?: string[];
  systemContext?: string;
};

export type HeartbeatCliStore = HeartbeatTaskStore;
