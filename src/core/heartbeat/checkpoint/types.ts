import type { AgentLoopCheckpoint } from '@/core/runtime/loop/index.js';
import type { AgentHeartbeatResult, RunAgentHeartbeatOptions } from '../agent/index.js';

export type HeartbeatCheckpointStore = {
  load: () => Promise<AgentLoopCheckpoint | undefined>;
  save: (checkpoint: AgentLoopCheckpoint) => Promise<void>;
};

export type FileHeartbeatCheckpointRepositoryOptions = {
  path: string;
};

export type RunStoredHeartbeatOptions = Omit<RunAgentHeartbeatOptions, 'checkpoint'> & {
  store: HeartbeatCheckpointStore;
};

export type StoredHeartbeatResult = AgentHeartbeatResult & {
  loadedCheckpoint: boolean;
  nextDelayMs?: number;
};
