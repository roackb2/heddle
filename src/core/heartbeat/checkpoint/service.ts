/**
 * Stored heartbeat service.
 *
 * Runs a heartbeat runner with a checkpoint store, persists the new checkpoint,
 * and returns the next suggested delay. Scheduling semantics stay in
 * `HeartbeatSchedulerService`.
 */
import { HeartbeatDecisionPolicy, HeartbeatRunnerAgent } from '../agent/index.js';
import type { RunStoredHeartbeatOptions, StoredHeartbeatResult } from './types.js';

export class StoredHeartbeatService {
  static async run(options: RunStoredHeartbeatOptions): Promise<StoredHeartbeatResult> {
    const checkpoint = await options.store.load();
    const result = await HeartbeatRunnerAgent.run({
      ...options,
      checkpoint,
    });
    await options.store.save(result.checkpoint);

    return {
      ...result,
      loadedCheckpoint: Boolean(checkpoint),
      nextDelayMs: HeartbeatDecisionPolicy.suggestNextDelayMs(result.decision),
    };
  }
}
