import type { ChatSession } from '../types.js';
import { resolveDefaultReasoningEffort, supportsReasoningEffort } from '../../llm/model-policy.js';
import type { ReasoningEffort } from '../../llm/types.js';

export type SessionExecutionPreferences = {
  model: string;
  reasoningEffort?: ReasoningEffort;
};

export type SessionPreferenceSyncAction =
  | { kind: 'none' }
  | { kind: 'adopt_session_preferences'; preferences: SessionExecutionPreferences }
  | { kind: 'persist_active_preferences'; preferences: SessionExecutionPreferences };

export function resolveSessionExecutionPreferences(args: {
  session?: Pick<ChatSession, 'model' | 'reasoningEffort'>;
  defaultModel: string;
}): SessionExecutionPreferences {
  return {
    model: args.session?.model ?? args.defaultModel,
    reasoningEffort: args.session?.reasoningEffort,
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
  return args.reasoningEffort ?? resolveDefaultReasoningEffort(args.model);
}

export function formatSessionReasoningEffortStatus(args: {
  model: string;
  reasoningEffort?: ReasoningEffort;
}): string {
  const supported = supportsReasoningEffort(args.model);
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

export function resolveSessionPreferenceSync(args: {
  previousSessionId?: string;
  currentSessionId?: string;
  currentSession?: Pick<ChatSession, 'model' | 'reasoningEffort'>;
  activePreferences: SessionExecutionPreferences;
  defaultModel: string;
}): SessionPreferenceSyncAction {
  if (!args.currentSessionId || !args.currentSession) {
    return { kind: 'none' };
  }

  const storedPreferences = resolveSessionExecutionPreferences({
    session: args.currentSession,
    defaultModel: args.defaultModel,
  });
  const sessionChanged = args.previousSessionId !== args.currentSessionId;

  if (sessionChanged) {
    if (sessionExecutionPreferencesEqual(storedPreferences, args.activePreferences)) {
      return { kind: 'none' };
    }

    return {
      kind: 'adopt_session_preferences',
      preferences: storedPreferences,
    };
  }

  if (sessionExecutionPreferencesEqual(storedPreferences, args.activePreferences)) {
    return { kind: 'none' };
  }

  return {
    kind: 'persist_active_preferences',
    preferences: args.activePreferences,
  };
}

export function sessionExecutionPreferencesEqual(
  left: SessionExecutionPreferences,
  right: SessionExecutionPreferences,
): boolean {
  return left.model === right.model && left.reasoningEffort === right.reasoningEffort;
}
