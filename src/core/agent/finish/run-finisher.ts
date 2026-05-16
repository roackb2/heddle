import { INTERRUPTED_SUMMARY } from '../constants.js';
import type { LlmResponse } from '@/core/llm/types.js';
import type { RunResult, StopReason } from '@/core/types.js';
import type { AgentRunContext } from '../types.js';
import type { FinishAgentRunLogging } from './types.js';

/**
 * Owns terminal run outcomes and final RunResult shaping.
 */
export class AgentRunFinisher {
  static maybeInterrupted(context: AgentRunContext, logMessage: string): RunResult | undefined {
    if (!context.shouldStop?.()) {
      return undefined;
    }

    return AgentRunFinisher.finishInterrupted(context, logMessage);
  }

  static finishInterrupted(context: AgentRunContext, logMessage: string): RunResult {
    return AgentRunFinisher.finish(context, 'interrupted', INTERRUPTED_SUMMARY, {
      logLevel: 'info',
      logMessage,
    });
  }

  static finishAssistantResponse(context: AgentRunContext, response: LlmResponse): RunResult | 'continue' {
    if (!response.content) {
      return AgentRunFinisher.finish(context, 'error', 'Model returned an empty response');
    }

    context.record({
      type: 'assistant.turn',
      content: response.content,
      diagnostics: response.diagnostics,
      requestedTools: false,
      step: context.state.step,
      timestamp: context.now(),
    });
    context.messages.push({ role: 'assistant', content: response.content });

    return AgentRunFinisher.finish(context, 'done', response.content, {
      logLevel: 'info',
      logMessage: 'Agent run finished',
    });
  }

  static maxSteps(context: AgentRunContext): RunResult {
    return AgentRunFinisher.finish(context, 'max_steps', `Reached maximum step limit (${context.maxSteps})`, {
      logLevel: 'warn',
      logMessage: 'Budget exhausted',
    });
  }

  static finish(
    context: AgentRunContext,
    outcome: StopReason,
    summary: string,
    logging?: FinishAgentRunLogging,
  ): RunResult {
    context.state.outcome = outcome;
    context.state.summary = summary;

    if (logging) {
      context.log[logging.logLevel]({ step: context.state.step, outcome, maxSteps: context.maxSteps }, logging.logMessage);
    }

    context.record({
      type: 'run.finished',
      outcome,
      summary,
      step: context.state.step,
      timestamp: context.now(),
    });

    return {
      outcome,
      summary,
      trace: context.trace.getTrace(),
      transcript: context.messages.slice(1),
      usage: context.state.usage,
    };
  }

  static isRunResult(value: LlmResponse | RunResult): value is RunResult {
    return 'outcome' in value;
  }
}
