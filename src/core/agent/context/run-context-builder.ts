import { resolve } from 'node:path';
import { ToolRegistry } from '@/core/tools/index.js';
import { TraceRecorder } from '@/core/trace/index.js';
import { buildSystemPrompt } from '@/core/prompts/system-prompt.js';
import { logger as defaultLogger } from '@/core/utils/logger.js';
import { DEFAULT_MAX_STEPS } from '../constants.js';
import { AgentStepBudget } from '../budget/index.js';
import { AgentHistorySanitizer } from '../history/index.js';
import { AgentMemoryCheckpointTracker } from '../memory/index.js';
import { AgentMutationTracker } from '../mutation/index.js';
import type { BuildAgentRunContextArgs, BuildInitialAgentMessagesArgs } from './types.js';
import type { AgentRunContext } from '../types.js';
import type { ChatMessage } from '@/core/llm/types.js';

/**
 * Builds the mutable context for one low-level agent run.
 */
export class AgentRunContextBuilder {
  static create(options: BuildAgentRunContextArgs): AgentRunContext {
    const registry = new ToolRegistry(options.tools);
    const trace = new TraceRecorder();
    const now = () => new Date().toISOString();
    const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
    const toolNames = registry.names();

    return {
      goal: options.goal,
      maxSteps,
      llm: options.llm,
      registry,
      workspaceRoot: resolve(options.workspaceRoot ?? process.cwd()),
      log: options.logger ?? defaultLogger,
      messages: AgentRunContextBuilder.buildInitialMessages({
        goal: options.goal,
        toolNames,
        systemContext: options.systemContext,
        history: options.history,
      }),
      trace,
      record: (event) => {
        trace.record(event);
        options.onEvent?.(event);
      },
      now,
      budget: new AgentStepBudget(maxSteps),
      seenToolCalls: new Map<string, number>(),
      mutation: AgentMutationTracker.createState(),
      onAssistantStream: options.onAssistantStream,
      onToolCalling: options.onToolCalling,
      onToolCompleted: options.onToolCompleted,
      approvalPolicies: options.approvalPolicies ?? [],
      approveToolCall: options.approveToolCall,
      shouldStop: options.shouldStop,
      abortSignal: options.abortSignal,
      state: {
        step: 0,
        consecutiveErrors: 0,
        executedToolCalls: 0,
        outcome: 'max_steps',
        summary: '',
        memoryCheckpoint: AgentMemoryCheckpointTracker.createState({
          goal: options.goal,
          toolNames,
        }),
        reminders: {
          postMutationFollowUpSent: false,
          memoryCheckpointSent: false,
          structuredSummarySent: false,
        },
      },
    };
  }

  static buildInitialMessages(args: BuildInitialAgentMessagesArgs): ChatMessage[] {
    return [
      { role: 'system', content: buildSystemPrompt(args.toolNames, args.systemContext) },
      ...AgentHistorySanitizer.sanitize({ history: args.history ?? [] }),
      { role: 'user', content: args.goal },
    ];
  }
}
