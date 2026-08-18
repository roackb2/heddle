import { randomUUID } from 'node:crypto';
import dayjs from 'dayjs';
import { RuntimeSubscriptionStream } from '@/core/runtime/subscriptions/index.js';
import { HeartbeatRunnerAgent } from '../agent/index.js';
import type {
  HeartbeatRunHandle,
  HeartbeatRunServiceOptions,
  HeartbeatRunStreamItem,
  HeartbeatRunner,
} from './types.js';
import type { RunAgentHeartbeatOptions } from '../agent/index.js';

const HEARTBEAT_CANCELLED_MESSAGE = 'Heartbeat run was cancelled.';
const HEARTBEAT_FAILED_MESSAGE = 'The heartbeat run could not complete.';

type HeartbeatRunStreamPayload = HeartbeatRunStreamItem extends infer Item
  ? Item extends unknown
    ? Omit<Item, 'runId' | 'sequence' | 'timestamp'>
    : never
  : never;

/**
 * Owns the process-local lifecycle for one explicitly requested heartbeat run.
 *
 * Scheduling and durable task settlement remain in the heartbeat scheduler;
 * deployment-specific model, tool, and MCP composition remain with the host.
 */
export class HeartbeatRunService {
  private readonly createRunId: () => string;
  private readonly now: () => string;
  private readonly runner: HeartbeatRunner;

  constructor(options: HeartbeatRunServiceOptions = {}) {
    this.createRunId = options.createRunId ?? (() => `heartbeat-run-${randomUUID()}`);
    this.now = options.now ?? (() => dayjs().toISOString());
    this.runner = options.runner ?? HeartbeatRunnerAgent.run.bind(HeartbeatRunnerAgent);
  }

  start(options: RunAgentHeartbeatOptions): HeartbeatRunHandle {
    const runId = this.createRunId();
    const controller = new AbortController();
    const signal = options.abortSignal
      ? AbortSignal.any([options.abortSignal, controller.signal])
      : controller.signal;
    const stream = new RuntimeSubscriptionStream<HeartbeatRunStreamItem>();
    let sequence = 0;
    let terminal = false;

    const publish = (item: HeartbeatRunStreamPayload): void => {
      if (terminal) {
        return;
      }

      const isTerminal = item.kind !== 'activity';
      terminal = isTerminal;
      sequence += 1;
      stream.sink.push({
        ...item,
        runId,
        sequence,
        timestamp: this.now(),
      } as HeartbeatRunStreamItem);
      if (isTerminal) {
        stream.sink.close();
      }
    };

    const result = Promise.resolve()
      .then(async () => {
        HeartbeatRunService.throwIfCancelled(signal);
        const heartbeatResult = await this.runner({
          ...options,
          abortSignal: signal,
          onEvent: (event) => {
            publish({ kind: 'activity', activity: event });
            options.onEvent?.(event);
          },
        });
        HeartbeatRunService.throwIfCancelled(signal);
        publish({ kind: 'result', result: heartbeatResult });
        return heartbeatResult;
      })
      .catch((error: unknown) => {
        publish(signal.aborted
          ? { kind: 'cancelled', reason: HEARTBEAT_CANCELLED_MESSAGE }
          : {
            kind: 'error',
            error: {
              code: 'heartbeat_run_failed',
              message: HEARTBEAT_FAILED_MESSAGE,
            },
          });
        throw error;
      });
    result.catch(() => undefined);

    return {
      runId,
      result,
      events: () => stream,
      cancel: () => {
        if (terminal || signal.aborted) {
          return false;
        }
        controller.abort(new Error(HEARTBEAT_CANCELLED_MESSAGE));
        return true;
      },
    };
  }

  private static throwIfCancelled(signal: AbortSignal): void {
    if (!signal.aborted) {
      return;
    }

    throw signal.reason instanceof Error
      ? signal.reason
      : new Error(HEARTBEAT_CANCELLED_MESSAGE);
  }
}
