import { INTERRUPTED_SUMMARY } from '../constants.js';
import { HeddleEventType } from '@/core/event-types.js';
import type { LlmResponse } from '@/core/llm/types.js';
import type { RunResult, StopReason } from '@/core/types.js';
import type { AgentRunContext } from '../types.js';
import type { FinishAgentRunOptions } from './types.js';

/**
 * Owns terminal run outcomes and final RunResult shaping.
 */
export class AgentRunFinisher {
  static isInterrupted(context: AgentRunContext): boolean {
    return context.abortSignal?.aborted === true || context.shouldStop?.() === true;
  }

  static maybeInterrupted(context: AgentRunContext, logMessage: string): RunResult | undefined {
    if (!AgentRunFinisher.isInterrupted(context)) {
      return undefined;
    }

    return AgentRunFinisher.finishInterrupted(context, logMessage);
  }

  static finishInterrupted(context: AgentRunContext, logMessage: string): RunResult {
    return AgentRunFinisher.finish(context, 'interrupted', INTERRUPTED_SUMMARY, {
      logging: {
        logLevel: 'info',
        logMessage,
      },
    });
  }

  static finishAssistantResponse(context: AgentRunContext, response: LlmResponse): RunResult | 'continue' {
    if (!response.content) {
      return AgentRunFinisher.finish(context, 'error', 'Model returned an empty response');
    }

    context.live.trace({
      type: HeddleEventType.assistantTurn,
      content: response.content,
      diagnostics: response.diagnostics,
      requestedTools: false,
      step: context.state.step,
      timestamp: context.now(),
    });
    context.messages.push({
      role: 'assistant',
      content: response.content,
      providerContinuation: response.providerContinuation,
    });

    return AgentRunFinisher.finish(context, 'done', response.content, {
      logging: {
        logLevel: 'info',
        logMessage: 'Agent run finished',
      },
    });
  }

  static maxSteps(context: AgentRunContext): RunResult {
    return AgentRunFinisher.finish(context, 'max_steps', `Reached maximum step limit (${context.maxSteps})`, {
      logging: {
        logLevel: 'warn',
        logMessage: 'Budget exhausted',
      },
    });
  }

  static finish(
    context: AgentRunContext,
    outcome: StopReason,
    summary: string,
    options: FinishAgentRunOptions = {},
  ): RunResult {
    context.state.outcome = outcome;
    context.state.summary = summary;

    if (options.logging) {
      context.log[options.logging.logLevel](
        { step: context.state.step, outcome, maxSteps: context.maxSteps },
        options.logging.logMessage,
      );
    }

    context.live.trace({
      type: HeddleEventType.runFinished,
      outcome,
      summary,
      ...(options.failure ? { failure: options.failure } : {}),
      step: context.state.step,
      timestamp: context.now(),
    });

    return {
      outcome,
      summary,
      ...(options.failure ? { failure: options.failure } : {}),
      trace: context.trace.getTrace(),
      transcript: context.messages.slice(1),
      usage: context.state.usage,
    };
  }

  static isRunResult(value: LlmResponse | RunResult): value is RunResult {
    return 'outcome' in value;
  }
}
