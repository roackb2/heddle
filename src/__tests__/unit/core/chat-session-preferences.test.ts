import { describe, expect, it } from 'vitest';
import {
  formatSessionReasoningEffortStatus,
  resolveEffectiveReasoningEffort,
  resolveNewSessionExecutionPreferences,
  resolveSessionExecutionPreferences,
  resolveSessionPreferenceSync,
} from '../../../core/chat/session-preferences/service.js';

describe('chat session preferences', () => {
  it('resolves stored session preferences with a fallback model', () => {
    expect(resolveSessionExecutionPreferences({
      session: {
        model: undefined,
        reasoningEffort: 'low',
      },
      defaultModel: 'gpt-5.4',
    })).toEqual({
      model: 'gpt-5.4',
      reasoningEffort: 'low',
    });
  });

  it('inherits the active model and reasoning effort for a new session', () => {
    expect(resolveNewSessionExecutionPreferences({
      defaultModel: 'gpt-5.4',
      inherited: {
        model: 'gpt-5.5',
        reasoningEffort: 'low',
      },
    })).toEqual({
      model: 'gpt-5.5',
      reasoningEffort: 'low',
    });
  });

  it('adopts stored session preferences when switching sessions', () => {
    expect(resolveSessionPreferenceSync({
      previousSessionId: 'session-a',
      currentSessionId: 'session-b',
      currentSession: {
        model: 'gpt-5.5',
        reasoningEffort: 'low',
      },
      activePreferences: {
        model: 'gpt-5.4',
        reasoningEffort: 'medium',
      },
      defaultModel: 'gpt-5.4',
    })).toEqual({
      kind: 'adopt_session_preferences',
      preferences: {
        model: 'gpt-5.5',
        reasoningEffort: 'low',
      },
    });
  });

  it('persists active preferences when the current session changes locally', () => {
    expect(resolveSessionPreferenceSync({
      previousSessionId: 'session-a',
      currentSessionId: 'session-a',
      currentSession: {
        model: 'gpt-5.4',
        reasoningEffort: undefined,
      },
      activePreferences: {
        model: 'gpt-5.5',
        reasoningEffort: 'medium',
      },
      defaultModel: 'gpt-5.4',
    })).toEqual({
      kind: 'persist_active_preferences',
      preferences: {
        model: 'gpt-5.5',
        reasoningEffort: 'medium',
      },
    });
  });

  it('resolves the effective reasoning effort from explicit or model-default state', () => {
    expect(resolveEffectiveReasoningEffort({
      model: 'gpt-5.4',
      reasoningEffort: undefined,
    })).toBe('medium');
    expect(resolveEffectiveReasoningEffort({
      model: 'gpt-5.4',
      reasoningEffort: 'low',
    })).toBe('low');
  });

  it('formats a shared reasoning-effort status message', () => {
    expect(formatSessionReasoningEffortStatus({
      model: 'gpt-5.4',
      reasoningEffort: undefined,
    })).toContain('Effective effort: medium');
  });
});
