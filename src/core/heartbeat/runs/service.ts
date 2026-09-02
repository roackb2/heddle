import { randomUUID } from 'node:crypto';
import dayjs from 'dayjs';
import { RuntimeSubscriptionStream } from '@/core/runtime/subscriptions/index.js';
import { HeartbeatRunnerAgent } from '../agent/index.js';
import type {
  HeartbeatRunContext,
  HeartbeatRunHandle,
  HeartbeatRunResultProjector,
  HeartbeatRunServiceOptions,
  HeartbeatRunStreamItem,
  HeartbeatRunner,
  StartHeartbeatRunInput,
  StartProjectedHeartbeatRunInput,
} from './types.js';
import type { AgentHeartbeatResult } from '../agent/index.js';

const HEARTBEAT_CANCELLED_MESSAGE = 'Heartbeat run was cancelled.';
const HEARTBEAT_FAILED_MESSAGE = 'The heartbeat run could not complete.';

type HeartbeatRunStreamPayload<Result> = HeartbeatRunStreamItem<Result> extends infer Item
  ? Item extends unknown
    ? Omit<Item, 'runId' | 'sequence' | 'timestamp'>
    : never
  : never;

/**
 * Owns the process-local lifecycle for one explicitly requested heartbeat run.
 *
 * An optional result projector is awaited before public success settlement.
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

  start<Result>(options: StartProjectedHeartbeatRunInput<Result>): HeartbeatRunHandle<Result>;
  start(options: StartHeartbeatRunInput): HeartbeatRunHandle;
  start<Result>(
    options: StartHeartbeatRunInput | StartProjectedHeartbeatRunInput<Result>,
  ): HeartbeatRunHandle<AgentHeartbeatResult | Result> {
    const runId = this.createRunId();
    const controller = new AbortController();
    const signal = options.abortSignal
      ? AbortSignal.any([options.abortSignal, controller.signal])
      : controller.signal;
    const stream = new RuntimeSubscriptionStream<HeartbeatRunStreamItem<AgentHeartbeatResult | Result>>();
    const context: HeartbeatRunContext = { runId, signal };
    const projectResult = 'projectResult' in options
      ? options.projectResult
      : undefined;
    const { projectResult: _projectResult, ...runnerOptions } = options as
      StartProjectedHeartbeatRunInput<Result>;
    let sequence = 0;
    let terminal = false;

    const publish = (item: HeartbeatRunStreamPayload<AgentHeartbeatResult | Result>): void => {
      if (terminal) {
        return;
      }

      const projected = toJsonCompatible(item);
      const isTerminal = projected.kind !== 'activity';
      terminal = isTerminal;
      sequence += 1;
      stream.sink.push({
        ...projected,
        runId,
        sequence,
        timestamp: this.now(),
      } as HeartbeatRunStreamItem<AgentHeartbeatResult | Result>);
      if (isTerminal) {
        stream.sink.close();
      }
    };

    const result = Promise.resolve()
      .then(async () => {
        HeartbeatRunService.throwIfCancelled(signal);
        const heartbeatResult = await this.runner({
          ...runnerOptions,
          abortSignal: signal,
          onEvent: (event) => {
            publish({ kind: 'activity', activity: event });
            runnerOptions.onEvent?.(event);
          },
        });
        HeartbeatRunService.throwIfCancelled(signal);
        const projectedResult = await HeartbeatRunService.projectResult(
          projectResult,
          heartbeatResult,
          context,
        );
        HeartbeatRunService.throwIfCancelled(signal);
        publish({ kind: 'result', result: projectedResult });
        return projectedResult;
      })
      .catch((error: unknown) => {
        if (signal.aborted) {
          publish({ kind: 'cancelled', reason: HEARTBEAT_CANCELLED_MESSAGE });
          HeartbeatRunService.throwIfCancelled(signal);
        }

        publish({
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

  private static async projectResult<Result>(
    projectResult: HeartbeatRunResultProjector<Result> | undefined,
    result: AgentHeartbeatResult,
    run: HeartbeatRunContext,
  ): Promise<AgentHeartbeatResult | Result> {
    if (!projectResult) {
      return result;
    }

    return await projectResult(result, run);
  }
}

/**
 * Projects rich in-process events onto the same JSON value boundary used by
 * durable heartbeat stores and Execution Host transports. This removes
 * optional `undefined` properties without making every host rebuild the
 * serialization step that Heddle's run service promises to own.
 */
function toJsonCompatible<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value)) as Value;
}
