import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { runAgentHeartbeat } from './heartbeat.js';
import type { AgentHeartbeatResult, RunAgentHeartbeatOptions } from './heartbeat.js';
import type { AgentLoopCheckpoint } from './events.js';

export type HeartbeatCheckpointStore = {
  load: () => Promise<AgentLoopCheckpoint | undefined>;
  save: (checkpoint: AgentLoopCheckpoint) => Promise<void>;
};

export type FileHeartbeatCheckpointStoreOptions = {
  path: string;
};

export type RunStoredHeartbeatOptions = Omit<RunAgentHeartbeatOptions, 'checkpoint'> & {
  store: HeartbeatCheckpointStore;
};

export type StoredHeartbeatResult = AgentHeartbeatResult & {
  loadedCheckpoint: boolean;
  nextDelayMs?: number;
};

export function createFileHeartbeatCheckpointStore(options: FileHeartbeatCheckpointStoreOptions): HeartbeatCheckpointStore {
  return {
    async load() {
      if (!existsSync(options.path)) {
        return undefined;
      }

      return JSON.parse(readFileSync(options.path, 'utf8')) as AgentLoopCheckpoint;
    },
    async save(checkpoint) {
      mkdirSync(dirname(options.path), { recursive: true });
      writeFileSync(options.path, JSON.stringify(checkpoint, null, 2));
    },
  };
}

export async function runStoredHeartbeat(options: RunStoredHeartbeatOptions): Promise<StoredHeartbeatResult> {
  const checkpoint = await options.store.load();
  const result = await runAgentHeartbeat({
    ...options,
    checkpoint,
  });
  await options.store.save(result.checkpoint);

  return {
    ...result,
    loadedCheckpoint: Boolean(checkpoint),
    nextDelayMs: suggestNextHeartbeatDelayMs(result.decision),
  };
}

export function suggestNextHeartbeatDelayMs(decision: AgentHeartbeatResult['decision']): number | undefined {
  switch (decision) {
    case 'continue':
      return 60_000;
    case 'pause':
      return 15 * 60_000;
    case 'complete':
    case 'escalate':
      return undefined;
  }
}
