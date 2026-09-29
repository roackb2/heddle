import { Semaphore } from 'async-mutex';
import {
  DEFAULT_MAX_TOOL_CONCURRENCY,
  MAX_TOOL_CONCURRENCY,
} from '../constants.js';
import type { ToolCall, ToolDefinition } from '@/core/types.js';

export type ScheduledAgentToolCall = {
  index: number;
  call: ToolCall;
  tool?: ToolDefinition;
};

/**
 * Owns bounded scheduling for one assistant response's authorized tool calls.
 *
 * The model chooses independent calls in one response; those calls overlap by
 * default when the adapter supports multiple calls. Tool owners may declare a
 * serial barrier for stateful tools, and hosts can set the limit to 1.
 */
export class AgentToolConcurrencyService {
  static resolveLimit(value: number | undefined): number {
    if (value === undefined) {
      return DEFAULT_MAX_TOOL_CONCURRENCY;
    }

    if (!Number.isInteger(value) || value < 1 || value > MAX_TOOL_CONCURRENCY) {
      throw new RangeError(
        `maxToolConcurrency must be an integer between 1 and ${MAX_TOOL_CONCURRENCY}`,
      );
    }

    return value;
  }

  static async execute<TCall extends ScheduledAgentToolCall, TResult>(args: {
    calls: TCall[];
    adapterSupportsParallel: boolean;
    maxConcurrency: number;
    isInterrupted: () => boolean;
    /**
     * Prepares one parallel batch or one serial barrier immediately before it
     * executes. Returning a subset lets authorization exclude denied calls.
     */
    prepareStage?: (calls: TCall[]) => Promise<TCall[]>;
    execute: (call: TCall) => Promise<TResult>;
  }): Promise<Map<number, TResult>> {
    const results = new Map<number, TResult>();
    const semaphore = new Semaphore(args.maxConcurrency);
    let batch: TCall[] = [];

    const flushParallelBatch = async (): Promise<void> => {
      if (batch.length === 0 || args.isInterrupted()) {
        batch = [];
        return;
      }

      const activeBatch = batch;
      batch = [];
      const preparedBatch = args.prepareStage
        ? await args.prepareStage(activeBatch)
        : activeBatch;
      if (args.isInterrupted()) {
        return;
      }

      const completed = await Promise.all(
        preparedBatch.map((call) =>
          semaphore.runExclusive(async () => {
            if (args.isInterrupted()) {
              return undefined;
            }

            return {
              index: call.index,
              result: await args.execute(call),
            };
          }),
        ),
      );

      completed.forEach((entry) => {
        if (entry) {
          results.set(entry.index, entry.result);
        }
      });
    };

    for (const call of args.calls) {
      if (args.isInterrupted()) {
        break;
      }

      if (AgentToolConcurrencyService.canRunInParallel(call, args)) {
        batch.push(call);
        continue;
      }

      await flushParallelBatch();
      if (args.isInterrupted()) {
        break;
      }

      const preparedCalls = args.prepareStage
        ? await args.prepareStage([call])
        : [call];
      if (args.isInterrupted()) {
        break;
      }

      for (const preparedCall of preparedCalls) {
        results.set(preparedCall.index, await args.execute(preparedCall));
      }
    }

    await flushParallelBatch();
    return results;
  }

  private static canRunInParallel(
    call: ScheduledAgentToolCall,
    args: {
      adapterSupportsParallel: boolean;
      maxConcurrency: number;
    },
  ): boolean {
    return args.adapterSupportsParallel
      && args.maxConcurrency > 1
      && call.tool !== undefined
      && call.tool.concurrency !== 'serial';
  }
}
