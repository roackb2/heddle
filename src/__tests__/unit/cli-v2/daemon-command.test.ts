import { describe, expect, it } from 'vitest';
import {
  ControlPlaneChatSessionPresenter,
  DaemonCliV2CommandEdgeService,
  parseDaemonArgs,
} from '@/cli-v2/commands/daemon-command.js';
import type { ResolvedRuntimeHost } from '@/core/runtime/daemon/index.js';

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

  it('prints the live server address and returns successfully when a daemon already exists', async () => {
    const runtimeHost: ResolvedRuntimeHost = {
      kind: 'server',
      registryPath: '/tmp/heddle-daemon-registry.json',
      serverId: 'server-1',
      mode: 'daemon',
      endpoint: {
        host: '127.0.0.1',
        port: 8765,
      },
      startedAt: '2026-06-02T00:00:00.000Z',
      lastSeenAt: '2026-06-02T00:00:01.000Z',
      stale: false,
      ageMs: 100,
    };
    const output: string[] = [];

    const result = await DaemonCliV2CommandEdgeService.run([], {
      runtimeHost,
      stdout: {
        write: (message) => output.push(message),
      },
    });

    expect(result.kind).toBe('attached');
    expect(output.join('')).toContain('Heddle control-plane server already running at http://127.0.0.1:8765');
    expect(output.join('')).toContain('serverId=server-1');
  });

  it('projects chat sessions without exposing full transcript bodies', () => {
    expect(ControlPlaneChatSessionPresenter.projectView({
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
        request: {
          usage: {
            inputTokens: 100,
            outputTokens: 150,
            totalTokens: 250,
          },
        },
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
      queuedPromptCount: 0,
      lastPrompt: 'Inspect the repo',
      lastOutcome: 'done',
      lastSummary: 'Found the implementation area.',
      context: {
        estimatedHistoryTokens: 100,
        request: {
          usage: {
            inputTokens: 100,
            outputTokens: 150,
            totalTokens: 250,
          },
        },
      },
    }]);
  });

  it('ignores invalid chat session records', () => {
    expect(ControlPlaneChatSessionPresenter.projectView({ id: 'missing-name' })).toEqual([]);
    expect(ControlPlaneChatSessionPresenter.projectView(null)).toEqual([]);
  });
});
