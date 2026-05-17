import type { ChatSession } from '@/core/chat/types.js';
import { ModelPolicyService } from '@/core/llm/models/index.js';
import type { ReasoningEffort } from '@/core/llm/types.js';

export type SessionExecutionPreferences = {
  model: string;
  reasoningEffort?: ReasoningEffort;
};

export function resolveStoredSessionExecutionPreferences(args: {
  stored?: Pick<ChatSession, 'model' | 'reasoningEffort'>;
  defaultModel: string;
}): SessionExecutionPreferences {
  return {
    model: args.stored?.model ?? args.defaultModel,
    reasoningEffort: args.stored?.reasoningEffort,
  };
}

export function resolveNewSessionExecutionPreferences(args: {
  defaultModel: string;
  inherited?: Partial<SessionExecutionPreferences>;
}): SessionExecutionPreferences {
  return {
    model: args.inherited?.model ?? args.defaultModel,
    reasoningEffort: args.inherited?.reasoningEffort,
  };
}

export function resolveEffectiveReasoningEffort(args: {
  model: string;
  reasoningEffort?: ReasoningEffort;
}): ReasoningEffort | undefined {
  return args.reasoningEffort ?? ModelPolicyService.resolveDefaultReasoningEffort(args.model);
}

export function formatSessionReasoningEffortStatus(args: {
  model: string;
  reasoningEffort?: ReasoningEffort;
}): string {
  const supported = ModelPolicyService.supportsReasoningEffort(args.model);
  const effective = resolveEffectiveReasoningEffort(args);
  return [
    `Current model: ${args.model}`,
    `Reasoning effort support: ${supported ? 'supported' : 'unsupported'}`,
    `Configured effort: ${args.reasoningEffort ?? 'default'}`,
    `Effective effort: ${effective ?? 'none'}`,
    '',
    'Use /reasoning set to choose an effort, or /reasoning default to clear it.',
  ].join('\n');
}
