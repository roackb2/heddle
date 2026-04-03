import { describe, expect, it, vi } from 'vitest';
import { runLocalCommand } from '../cli/chat/state/local-commands.js';

describe('runLocalCommand', () => {
  it('lists grouped common OpenAI model choices', () => {
    const result = runLocalCommand({
      prompt: '/models',
      activeModel: 'gpt-5.1-codex',
      setActiveModel: vi.fn(),
      sessions: [],
      recentSessions: [],
      activeSessionId: 'session-1',
      switchSession: vi.fn(),
      createSession: vi.fn(),
      renameSession: vi.fn(),
      removeSession: vi.fn(),
      clearConversation: vi.fn(),
      listRecentSessionsMessage: [],
    });

    expect(result).toMatchObject({
      handled: true,
      kind: 'message',
    });
    if (!result.handled || result.kind !== 'message') {
      throw new Error('expected /models to return a message result');
    }
    expect(result.message).toContain('GPT-5.4: gpt-5.4, gpt-5.4-pro, gpt-5.4-mini, gpt-5.4-nano');
    expect(result.message).toContain('GPT-4.1: gpt-4.1, gpt-4.1-mini, gpt-4.1-nano');
    expect(result.message).toContain('Reasoning series: o3-pro, o3, o3-mini, o4-mini');
  });

  it('recognizes supported shortlist models when switching', () => {
    const setActiveModel = vi.fn();
    const result = runLocalCommand({
      prompt: '/model gpt-5.4-mini',
      activeModel: 'gpt-5.1-codex',
      setActiveModel,
      sessions: [],
      recentSessions: [],
      activeSessionId: 'session-1',
      switchSession: vi.fn(),
      createSession: vi.fn(),
      renameSession: vi.fn(),
      removeSession: vi.fn(),
      clearConversation: vi.fn(),
      listRecentSessionsMessage: [],
    });

    expect(setActiveModel).toHaveBeenCalledWith('gpt-5.4-mini');
    expect(result).toEqual({
      handled: true,
      kind: 'message',
      message: 'Switched model to gpt-5.4-mini',
    });
  });
});
