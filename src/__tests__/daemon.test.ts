import { describe, expect, it } from 'vitest';
import { parseDaemonArgs, projectChatSessionView } from '../cli/daemon.js';

describe('daemon CLI helpers', () => {
  it('parses default daemon host and port', () => {
    expect(parseDaemonArgs([])).toEqual({
      host: '127.0.0.1',
      port: 8765,
      serveAssets: true,
    });
  });

  it('parses explicit daemon host and port', () => {
    expect(parseDaemonArgs(['--host', '0.0.0.0', '--port=9010'])).toEqual({
      host: '0.0.0.0',
      port: 9010,
      serveAssets: true,
    });
  });

  it('parses daemon dev mode without static assets', () => {
    expect(parseDaemonArgs(['--no-assets'])).toEqual({
      host: '127.0.0.1',
      port: 8765,
      serveAssets: false,
    });
  });

  it('projects chat sessions without exposing full transcript bodies', () => {
    expect(projectChatSessionView({
      id: 'session-1',
      name: 'Repo work',
      createdAt: '2026-04-15T01:00:00.000Z',
      updatedAt: '2026-04-15T02:00:00.000Z',
      model: 'gpt-5.1-codex-mini',
      driftEnabled: true,
      messages: [
        { role: 'user', text: 'hello' },
        { role: 'assistant', text: 'hi' },
      ],
      turns: [{
        prompt: 'Inspect the repo',
        outcome: 'done',
        summary: 'Found the implementation area.',
      }],
      context: {
        estimatedHistoryTokens: 100,
        lastRunTotalTokens: 250,
      },
    })).toEqual([{
      id: 'session-1',
      name: 'Repo work',
      createdAt: '2026-04-15T01:00:00.000Z',
      updatedAt: '2026-04-15T02:00:00.000Z',
      model: 'gpt-5.1-codex-mini',
      driftEnabled: true,
      messageCount: 2,
      turnCount: 1,
      lastPrompt: 'Inspect the repo',
      lastOutcome: 'done',
      lastSummary: 'Found the implementation area.',
      context: {
        estimatedHistoryTokens: 100,
        estimatedRequestTokens: undefined,
        lastRunInputTokens: undefined,
        lastRunOutputTokens: undefined,
        lastRunTotalTokens: 250,
      },
    }]);
  });

  it('ignores invalid chat session records', () => {
    expect(projectChatSessionView({ id: 'missing-name' })).toEqual([]);
    expect(projectChatSessionView(null)).toEqual([]);
  });
});
