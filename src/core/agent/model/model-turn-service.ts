import type { LlmStreamEvent, LlmUsage } from '@/core/llm/types.js';
import { HeddleEventType } from '@/core/event-types.js';
import { isAbortError } from '@/core/agent/utils/index.js';
import { STREAM_UPDATE_INTERVAL_MS } from '../constants.js';
import { AgentRunFinisher } from '../finish/index.js';
import type { AccumulateAgentUsageArgs, AgentModelTurnResult, RequestAgentModelTurnArgs } from './types.js';

/**
 * Owns one LLM request/stream step inside an agent run.
 */
export class AgentModelTurnService {
  static async request(args: RequestAgentModelTurnArgs): Promise<AgentModelTurnResult> {
    const { context } = args;
    if (context.abortSignal?.aborted) {
      return AgentRunFinisher.finishInterrupted(context, 'Agent run interrupted before LLM call');
    }

    try {
      const streamState = {
        content: '',
        reasoningSummary: '',
        lastRecordAt: 0,
      };
      const response = await context.llm.chat(
        context.messages,
        context.registry.list(),
        context.abortSignal,
        (event: LlmStreamEvent) => AgentModelTurnService.handleStreamEvent({ context, event, streamState }),
      );
      context.state.usage = AgentModelTurnService.accumulateUsage({
        current: context.state.usage,
        next: response.usage,
      });
      return response;
    } catch (error) {
      if (isAbortError(error) || context.abortSignal?.aborted || context.shouldStop?.()) {
        return AgentRunFinisher.finishInterrupted(context, 'Agent run interrupted during LLM call');
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      context.log.error({ step: context.state.step, error: errorMessage }, 'LLM call failed');
      return AgentRunFinisher.finish(context, 'error', `LLM error: ${errorMessage}`);
    }
  }

  private static handleStreamEvent(args: {
    context: RequestAgentModelTurnArgs['context'];
    event: LlmStreamEvent;
    streamState: {
      content: string;
      reasoningSummary: string;
      lastRecordAt: number;
    };
  }): void {
    const { context, event, streamState } = args;
    if (event.type === 'content.delta') {
      const nowMs = Date.now();
      streamState.content += event.delta;
      if (nowMs - streamState.lastRecordAt >= STREAM_UPDATE_INTERVAL_MS) {
        streamState.lastRecordAt = nowMs;
      }
      // Stream the accumulated assistant text through the live event path. This
      // is intentionally in-memory; durable session files are updated later by
      // turn persistence, not once per LLM delta.
      context.live.activity({ type: HeddleEventType.assistantStream, step: context.state.step, text: streamState.content, done: false });
      return;
    }

    if (event.type === 'content.done') {
      streamState.content = event.content;
      context.live.activity({ type: HeddleEventType.assistantStream, step: context.state.step, text: streamState.content, done: true });
      return;
    }

    if (event.type === 'reasoning_summary.delta') {
      streamState.reasoningSummary += event.delta;
      if (!streamState.content) {
        context.live.activity({
          type: HeddleEventType.assistantStream,
          step: context.state.step,
          text: AgentModelTurnService.formatReasoningSummary(streamState.reasoningSummary),
          done: false,
        });
      }
      return;
    }

    if (event.type === 'reasoning_summary.done') {
      streamState.reasoningSummary = event.text;
      if (!streamState.content) {
        context.live.activity({
          type: HeddleEventType.assistantStream,
          step: context.state.step,
          text: AgentModelTurnService.formatReasoningSummary(streamState.reasoningSummary),
          done: false,
        });
      }
    }
  }

  private static accumulateUsage(args: AccumulateAgentUsageArgs): LlmUsage | undefined {
    if (!args.next) {
      return args.current;
    }

    if (!args.current) {
      return { ...args.next };
    }

    const cachedInputTokens = (args.current.cachedInputTokens ?? 0) + (args.next.cachedInputTokens ?? 0);
    const reasoningTokens = (args.current.reasoningTokens ?? 0) + (args.next.reasoningTokens ?? 0);
    const requests = (args.current.requests ?? 0) + (args.next.requests ?? 0);

    return {
      inputTokens: args.current.inputTokens + args.next.inputTokens,
      outputTokens: args.current.outputTokens + args.next.outputTokens,
      totalTokens: args.current.totalTokens + args.next.totalTokens,
      cachedInputTokens: cachedInputTokens || undefined,
      reasoningTokens: reasoningTokens || undefined,
      requests: requests || undefined,
    };
  }

  private static formatReasoningSummary(text: string): string {
    const trimmed = AgentModelTurnService.stripReasoningSummaryMarkdown(text.trim());
    return trimmed ? `Thinking: ${trimmed}` : 'Thinking...';
  }

  private static stripReasoningSummaryMarkdown(text: string): string {
    return text
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/([.!?])([A-Z][A-Za-z ]{2,}:?)/g, '$1 $2');
  }
}
