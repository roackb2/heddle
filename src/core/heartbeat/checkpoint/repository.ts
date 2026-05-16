/**
 * File-backed heartbeat checkpoint repository.
 *
 * Owns single-checkpoint file I/O for one-off stored heartbeat usage. Scheduled
 * heartbeat tasks use `FileHeartbeatTaskRepository` because task checkpoints
 * are colocated with task/run storage.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AgentLoopCheckpoint } from '@/core/runtime/loop/index.js';
import { AgentLoopCheckpointSchema } from '../tasks/schemas.js';
import type { FileHeartbeatCheckpointRepositoryOptions, HeartbeatCheckpointStore } from './types.js';

export class FileHeartbeatCheckpointRepository implements HeartbeatCheckpointStore {
  private readonly path: string;

  constructor(options: FileHeartbeatCheckpointRepositoryOptions) {
    this.path = options.path;
  }

  async load(): Promise<AgentLoopCheckpoint | undefined> {
    if (!existsSync(this.path)) {
      return undefined;
    }

    try {
      const parsed = AgentLoopCheckpointSchema.safeParse(JSON.parse(readFileSync(this.path, 'utf8')) as unknown);
      return parsed.success ? parsed.data as AgentLoopCheckpoint : undefined;
    } catch {
      return undefined;
    }
  }

  async save(checkpoint: AgentLoopCheckpoint): Promise<void> {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, `${JSON.stringify(AgentLoopCheckpointSchema.parse(checkpoint), null, 2)}\n`);
  }
}
