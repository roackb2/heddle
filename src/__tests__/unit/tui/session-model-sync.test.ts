import { describe, expect, it } from 'vitest';
import { resolveSessionModelSync } from '../../../cli/chat/utils/session-model-sync.js';

describe('resolveSessionModelSync', () => {
  it('adopts the stored session model when switching sessions', () => {
    expect(resolveSessionModelSync({
      previousSessionId: 'session-a',
      currentSessionId: 'session-b',
      currentSessionModel: 'gpt-5.5',
      activeModel: 'gpt-5.4',
    })).toEqual({
      kind: 'adopt_session_model',
      model: 'gpt-5.5',
    });
  });

  it('does nothing when switching into a session that already matches the active model', () => {
    expect(resolveSessionModelSync({
      previousSessionId: 'session-a',
      currentSessionId: 'session-b',
      currentSessionModel: 'gpt-5.4',
      activeModel: 'gpt-5.4',
    })).toEqual({ kind: 'none' });
  });

  it('persists the active model when the same session changes model locally', () => {
    expect(resolveSessionModelSync({
      previousSessionId: 'session-a',
      currentSessionId: 'session-a',
      currentSessionModel: 'gpt-5.4',
      activeModel: 'gpt-5.5',
    })).toEqual({ kind: 'persist_active_model' });
  });
});
