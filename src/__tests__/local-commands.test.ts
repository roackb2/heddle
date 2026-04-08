import { describe, expect, it, vi } from 'vitest';
import { getLocalCommandHints, isLikelyLocalCommand, runLocalCommand } from '../cli/chat/state/local-commands.js';

function createCommandArgs(overrides: Partial<Parameters<typeof runLocalCommand>[0]> = {}): Parameters<typeof runLocalCommand>[0] {
  return {
    prompt: '/help',
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
    compactConversation: vi.fn(() => 'Compacted earlier session history to reduce context size.'),
    listRecentSessionsMessage: [],
    ...overrides,
  };
}

describe('runLocalCommand', () => {
  it('treats bare and partial slash command roots as local commands for hints', () => {
    expect(isLikelyLocalCommand('/')).toBe(true);
    expect(isLikelyLocalCommand('/h')).toBe(true);
    expect(isLikelyLocalCommand('/mo')).toBe(true);
    expect(isLikelyLocalCommand('/sess')).toBe(true);
    expect(isLikelyLocalCommand('/comp')).toBe(true);
  });

  it('does not treat absolute unix paths as slash commands', () => {
    expect(isLikelyLocalCommand('/Users/roackb2/Desktop/screenshot.png')).toBe(false);
  });

  it('lists grouped common built-in model choices with multi-line formatting', () => {
    const result = runLocalCommand(createCommandArgs({ prompt: '/model list' }));

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
    const result = runLocalCommand(createCommandArgs({ prompt: '/models' }));

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
    const result = runLocalCommand(createCommandArgs({
      prompt: '/model gpt-5.4-mini',
      setActiveModel,
    }));

    expect(setActiveModel).toHaveBeenCalledWith('gpt-5.4-mini');
    expect(result).toEqual({
      handled: true,
      kind: 'message',
      message: 'Switched model to gpt-5.4-mini',
    });
  });

  it('does not treat /model set as a literal model name', () => {
    const setActiveModel = vi.fn();
    const result = runLocalCommand(createCommandArgs({
      prompt: '/model set',
      setActiveModel,
    }));

    expect(setActiveModel).not.toHaveBeenCalled();
    expect(result).toEqual({
      handled: true,
      kind: 'message',
      message: 'Use /model set <query> to filter models, then use arrows and Enter to choose one.',
    });
  });

  it('allows switching sessions by recent-session index', () => {
    const switchSession = vi.fn();
    const sessions = [
      { id: 'session-a', name: 'A', history: [], messages: [], turns: [], createdAt: '2024-01-01', updatedAt: '2024-01-01' },
      { id: 'session-b', name: 'B', history: [], messages: [], turns: [], createdAt: '2024-01-02', updatedAt: '2024-01-02' },
    ];
    const result = runLocalCommand(createCommandArgs({
      prompt: '/session switch 2',
      sessions,
      recentSessions: sessions,
      activeSessionId: 'session-a',
      switchSession,
    }));

    expect(switchSession).toHaveBeenCalledWith('session-b');
    expect(result).toEqual({
      handled: true,
      kind: 'message',
      message: 'Switched to session-b (B).\n0 turns • no turns yet',
    });
  });

  it('allows continuing sessions by recent-session index', () => {
    const sessions = [
      { id: 'session-a', name: 'A', history: [], messages: [], turns: [], createdAt: '2024-01-01', updatedAt: '2024-01-01' },
      { id: 'session-b', name: 'B', history: [], messages: [], turns: [], createdAt: '2024-01-02', updatedAt: '2024-01-02' },
    ];
    const result = runLocalCommand(createCommandArgs({
      prompt: '/session continue 2',
      sessions,
      recentSessions: sessions,
      activeSessionId: 'session-a',
    }));

    expect(result).toEqual({
      handled: true,
      kind: 'continue',
      sessionId: 'session-b',
      message: 'Switched to session-b (B).\nContinuing from that session transcript.',
    });
  });

  it('passes through absolute unix paths as normal prompts', () => {
    const result = runLocalCommand(createCommandArgs({
      prompt: '/Users/roackb2/Desktop/screenshot.png can you describe this image',
    }));

    expect(result).toEqual({ handled: false });
  });

  it('runs manual compaction when requested', () => {
    const compactConversation = vi.fn(
      () => 'Compacted earlier session history to reduce context size (24 messages summarized).',
    );
    const result = runLocalCommand(createCommandArgs({
      prompt: '/compact',
      activeModel: 'claude-sonnet-4-6',
      compactConversation,
    }));

    expect(compactConversation).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      handled: true,
      kind: 'message',
      message: 'Compacted earlier session history to reduce context size (24 messages summarized).',
    });
  });

  it('includes /compact in shared slash-command hints', () => {
    const hints = getLocalCommandHints('/', 'session-1', []);

    expect(hints).toContainEqual({
      command: '/compact',
      description: 'compact earlier session history for the next run',
    });
  });
});
