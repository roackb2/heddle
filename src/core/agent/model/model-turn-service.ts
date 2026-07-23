import { setTimeout as sleep } from 'node:timers/promises';
import { LlmUsageService } from '@/core/llm/usage/index.js';
import type { LlmStreamEvent } from '@/core/llm/types.js';
import { HeddleEventType } from '@/core/event-types.js';
import { isAbortError } from '@/core/agent/utils/index.js';
import { STREAM_UPDATE_INTERVAL_MS } from '../constants.js';
import { AgentRunFinisher } from '../finish/index.js';
import type { AgentModelTurnResult, RequestAgentModelTurnArgs } from './types.js';
import { AgentModelTurnRetryService } from './model-turn-retry-service.js';

/**
 * Owns one LLM request/stream step inside an agent run.
 */
export class AgentModelTurnService {
  static async request(args: RequestAgentModelTurnArgs): Promise<AgentModelTurnResult> {
    const { context } = args;
    if (context.abortSignal?.aborted) {
      return AgentRunFinisher.finishInterrupted(context, 'Agent run interrupted before LLM call');
    }

    return AgentModelTurnService.requestWithRetries(args);
  }

  private static async requestWithRetries(args: RequestAgentModelTurnArgs): Promise<AgentModelTurnResult> {
    const { context } = args;
    let attempt = 1;

    while (true) {
      try {
        const response = await AgentModelTurnService.requestOnce(args);
        context.state.usage = LlmUsageService.aggregate(context.state.usage, response.usage);

        const retry = AgentModelTurnRetryService.resolve({ kind: 'response', response });
        if (!retry.retryable || attempt >= retry.maxAttempts) {
          return retry.retryable
            ? AgentRunFinisher.finish(
                context,
                'error',
                `${retry.message} after ${attempt} attempts`,
                { failure: retry.failure },
              )
            : response;
        }

        await AgentModelTurnService.recordRetryAndWait({ context, attempt, retry });
        attempt += 1;
      } catch (error) {
        if (isAbortError(error) || context.abortSignal?.aborted || context.shouldStop?.()) {
          return AgentRunFinisher.finishInterrupted(context, 'Agent run interrupted during LLM call');
        }

        const retry = AgentModelTurnRetryService.resolve({ kind: 'error', error });
        if (!retry.retryable || attempt >= retry.maxAttempts) {
          context.log.error({ step: context.state.step, error: retry.message, attempts: attempt }, 'LLM call failed');
          return AgentRunFinisher.finish(
            context,
            'error',
            attempt > 1 ? `LLM error after ${attempt} attempts: ${retry.message}` : `LLM error: ${retry.message}`,
            { failure: retry.failure },
          );
        }

        await AgentModelTurnService.recordRetryAndWait({ context, attempt, retry });
        attempt += 1;
      }
    }
  }

  private static async requestOnce(args: RequestAgentModelTurnArgs) {
    const { context } = args;
    const streamState = {
      content: '',
      commentary: new Map<string, { text: string; lastStreamEmitAt: number }>(),
      reasoningSummary: '',
      lastStreamEmitAt: 0,
    };

    return context.llm.chat(
      context.messages,
      context.registry.list(),
      context.abortSignal,
      (event: LlmStreamEvent) => AgentModelTurnService.handleStreamEvent({ context, event, streamState }),
    );
  }

  private static async recordRetryAndWait(args: {
    context: RequestAgentModelTurnArgs['context'];
    attempt: number;
    retry: ReturnType<typeof AgentModelTurnRetryService.resolve>;
  }): Promise<void> {
    const { context, attempt, retry } = args;
    const retryAfterMs = AgentModelTurnRetryService.nextDelayMs(attempt);

    context.live.trace({
      type: HeddleEventType.modelRetry,
      reason: retry.reason ?? 'transport_error',
      attempt,
      maxAttempts: retry.maxAttempts,
      retryAfterMs,
      message: retry.message,
      step: context.state.step,
      timestamp: context.now(),
    });
    context.log.warn(
      { step: context.state.step, attempt, maxAttempts: retry.maxAttempts, retryAfterMs, reason: retry.reason, message: retry.message },
      'Retrying LLM call',
    );

    try {
      await sleep(retryAfterMs, undefined, { signal: context.abortSignal });
    } catch (error) {
      if (isAbortError(error) || context.abortSignal?.aborted) {
        throw error;
      }
    }
  }

  private static handleStreamEvent(args: {
    context: RequestAgentModelTurnArgs['context'];
    event: LlmStreamEvent;
    streamState: {
      content: string;
      commentary: Map<string, { text: string; lastStreamEmitAt: number }>;
      reasoningSummary: string;
      lastStreamEmitAt: number;
    };
  }): void {
    const { context, event, streamState } = args;
    if (event.type === 'content.delta') {
      const nowMs = Date.now();
      streamState.content += event.delta;
      if (!AgentModelTurnService.shouldEmitStreamUpdate(streamState, nowMs)) {
        return;
      }
      // Stream the accumulated assistant text through the live event path. This
      // is intentionally in-memory; durable session files are updated later by
      // turn persistence, not once per LLM delta.
      context.live.activity({ type: HeddleEventType.assistantStream, step: context.state.step, text: streamState.content, done: false });
      return;
    }

    if (event.type === 'content.done') {
      streamState.content = event.content;
      streamState.lastStreamEmitAt = Date.now();
      context.live.activity({ type: HeddleEventType.assistantStream, step: context.state.step, text: streamState.content, done: true });
      return;
    }

    if (event.type === 'commentary.delta') {
      const commentary = streamState.commentary.get(event.messageId) ?? {
        text: '',
        lastStreamEmitAt: 0,
      };
      commentary.text += event.delta;
      streamState.commentary.set(event.messageId, commentary);
      if (!AgentModelTurnService.shouldEmitStreamUpdate(commentary, Date.now())) {
        return;
      }
      context.live.activity({
        type: HeddleEventType.assistantCommentary,
        step: context.state.step,
        messageId: event.messageId,
        text: commentary.text,
        done: false,
      });
      return;
    }

    if (event.type === 'commentary.done') {
      const commentary = streamState.commentary.get(event.messageId) ?? {
        text: '',
        lastStreamEmitAt: 0,
      };
      commentary.text = event.text;
      commentary.lastStreamEmitAt = Date.now();
      streamState.commentary.set(event.messageId, commentary);
      if (!commentary.text.trim()) {
        return;
      }
      context.live.activity({
        type: HeddleEventType.assistantCommentary,
        step: context.state.step,
        messageId: event.messageId,
        text: commentary.text,
        done: true,
      });
      return;
    }

    if (event.type === 'reasoning_summary.delta') {
      streamState.reasoningSummary += event.delta;
      if (streamState.content || !AgentModelTurnService.shouldEmitStreamUpdate(streamState, Date.now())) {
        return;
      }
      const text = streamState.reasoningSummary;
      if (!text.trim()) {
        return;
      }
      context.live.activity({
        type: HeddleEventType.reasoningSummary,
        step: context.state.step,
        text,
        done: false,
      });
      return;
    }

    if (event.type === 'reasoning_summary.done') {
      streamState.reasoningSummary = event.text;
      if (!streamState.content) {
        const text = streamState.reasoningSummary;
        if (!text.trim()) {
          return;
        }
        streamState.lastStreamEmitAt = Date.now();
        context.live.activity({
          type: HeddleEventType.reasoningSummary,
          step: context.state.step,
          text,
          done: true,
        });
      }
    }
  }

  private static shouldEmitStreamUpdate(
    streamState: { lastStreamEmitAt: number },
    nowMs: number,
  ): boolean {
    if (streamState.lastStreamEmitAt && nowMs - streamState.lastStreamEmitAt < STREAM_UPDATE_INTERVAL_MS) {
      return false;
    }

    streamState.lastStreamEmitAt = nowMs;
    return true;
  }
}
