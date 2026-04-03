import { describe, expect, it, vi } from 'vitest';
import { runLocalCommand } from '../cli/chat/state/local-commands.js';

describe('runLocalCommand', () => {
  it('lists grouped common built-in model choices with multi-line formatting', () => {
    const result = runLocalCommand({
      prompt: '/model list',
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
      throw new Error('expected /model list to return a message result');
    }
    expect(result.message).toContain('Common built-in model choices');
    expect(result.message).toContain('OpenAI · GPT-5.4\n  - gpt-5.4\n  - gpt-5.4-pro\n  - gpt-5.4-mini\n  - gpt-5.4-nano');
    expect(result.message).toContain('OpenAI · GPT-4.1\n  - gpt-4.1\n  - gpt-4.1-mini\n  - gpt-4.1-nano');
    expect(result.message).toContain('Anthropic · Claude 4\n  - claude-opus-4-6\n  - claude-sonnet-4-6\n  - claude-haiku-4-5');
    expect(result.message).toContain('Anthropic · Earlier Claude 4\n  - claude-opus-4-1\n  - claude-opus-4-0\n  - claude-sonnet-4-0');
    expect(result.message).toContain('Anthropic · Claude 3.5\n  - claude-3-5-sonnet-latest\n  - claude-3-5-haiku-latest');
  });

  it('keeps /models as a compatibility alias for /model list', () => {
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
    expect(result.message).toContain('Common built-in model choices');
    expect(result.message).toContain('OpenAI · GPT-5.4\n  - gpt-5.4');
    expect(result.message).toContain('Anthropic · Claude 4\n  - claude-opus-4-6');
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

  it('does not treat /model set as a literal model name', () => {
    const setActiveModel = vi.fn();
    const result = runLocalCommand({
      prompt: '/model set',
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

    expect(setActiveModel).not.toHaveBeenCalled();
    expect(result).toEqual({
      handled: true,
      kind: 'message',
      message: 'Use /model set <query> to filter models, then use arrows and Enter to choose one.',
    });
  });

  it('allows switching sessions by recent-session index', () => {
    const switchSession = vi.fn();
    const result = runLocalCommand({
      prompt: '/session switch 2',
      activeModel: 'gpt-5.1-codex',
      setActiveModel: vi.fn(),
      sessions: [
        { id: 'session-a', name: 'A', history: [], messages: [], turns: [], createdAt: '2024-01-01', updatedAt: '2024-01-01' },
        { id: 'session-b', name: 'B', history: [], messages: [], turns: [], createdAt: '2024-01-02', updatedAt: '2024-01-02' },
      ],
      recentSessions: [
        { id: 'session-a', name: 'A', history: [], messages: [], turns: [], createdAt: '2024-01-01', updatedAt: '2024-01-01' },
        { id: 'session-b', name: 'B', history: [], messages: [], turns: [], createdAt: '2024-01-02', updatedAt: '2024-01-02' },
      ],
      activeSessionId: 'session-a',
      switchSession,
      createSession: vi.fn(),
      renameSession: vi.fn(),
      removeSession: vi.fn(),
      clearConversation: vi.fn(),
      listRecentSessionsMessage: [],
    });

    expect(switchSession).toHaveBeenCalledWith('session-b');
    expect(result).toEqual({
      handled: true,
      kind: 'message',
      message: 'Switched to session-b (B).\n0 turns • no turns yet',
    });
  });

  it('allows continuing sessions by recent-session index', () => {
    const result = runLocalCommand({
      prompt: '/session continue 2',
      activeModel: 'gpt-5.1-codex',
      setActiveModel: vi.fn(),
      sessions: [
        { id: 'session-a', name: 'A', history: [], messages: [], turns: [], createdAt: '2024-01-01', updatedAt: '2024-01-01' },
        { id: 'session-b', name: 'B', history: [], messages: [], turns: [], createdAt: '2024-01-02', updatedAt: '2024-01-02' },
      ],
      recentSessions: [
        { id: 'session-a', name: 'A', history: [], messages: [], turns: [], createdAt: '2024-01-01', updatedAt: '2024-01-01' },
        { id: 'session-b', name: 'B', history: [], messages: [], turns: [], createdAt: '2024-01-02', updatedAt: '2024-01-02' },
      ],
      activeSessionId: 'session-a',
      switchSession: vi.fn(),
      createSession: vi.fn(),
      renameSession: vi.fn(),
      removeSession: vi.fn(),
      clearConversation: vi.fn(),
      listRecentSessionsMessage: [],
    });

    expect(result).toEqual({
      handled: true,
      kind: 'continue',
      sessionId: 'session-b',
      message: 'Switched to session-b (B).\nContinuing from that session transcript.',
    });
  });
});
