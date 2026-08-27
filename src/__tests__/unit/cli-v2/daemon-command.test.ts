import { describe, expect, it } from 'vitest';
import {
  ControlPlaneChatSessionPresenter,
  DaemonCliV2CommandEdgeService,
  parseDaemonArgs,
  renderDaemonHelp,
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

  it('renders daemon command help with daemon-specific options', () => {
    const help = renderDaemonHelp();

    expect(help).toContain('Usage: heddle daemon [options]');
    expect(help).toContain('--host <host>');
    expect(help).toContain('--port <port>');
    expect(help).toContain('--assets-dir <path>');
    expect(help).toContain('--no-assets');
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
      pinned: false,
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
      pinned: false,
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

  it('projects settled delegation evidence into session detail without raw child runtime fields', () => {
    const detail = ControlPlaneChatSessionPresenter.projectDetail({
      id: 'session-1',
      name: 'Subagent work',
      pinned: false,
      messages: [{ id: 'message-1', role: 'user', text: 'Inspect the runtime' }],
      turns: [{
        id: 'turn-1',
        prompt: 'Inspect the runtime',
        outcome: 'done',
        summary: 'Done.',
        steps: 2,
        traceFile: '/tmp/root-trace.json',
        events: [],
        delegations: [{
          schemaVersion: 1,
          delegationId: 'delegation-1',
          rootRunId: 'run-root-1',
          parentRunId: 'run-root-1',
          childRunId: 'run-child-1',
          depth: 1,
          task: 'Inspect the shared client.',
          agentSnapshot: {
            agentProfileId: 'builtin:ask',
            agentName: 'Ask',
            modeAlias: 'ask',
            source: 'built-in',
            definitionHash: 'ask-definition',
            runtime: { maxSteps: 24 },
            toolProfile: { preset: 'inspect', memoryMode: 'none' },
            approvalProfile: { preset: 'read_only' },
            systemContextAppendix: 'Read only.',
          },
          status: 'finished',
          outcome: 'done',
          summary: 'Found the projection.',
          startedAt: '2026-08-27T08:00:00.000Z',
          finishedAt: '2026-08-27T08:00:03.000Z',
        }],
      }],
    })[0];

    expect(detail?.turns[0]?.delegations).toEqual([expect.objectContaining({
      delegationId: 'delegation-1',
      summary: 'Found the projection.',
    })]);
    expect(detail?.turns[0]?.delegations?.[0]).not.toHaveProperty('trace');
    expect(detail?.turns[0]?.delegations?.[0]).not.toHaveProperty('model');
    expect(detail?.turns[0]?.delegations?.[0]).not.toHaveProperty('provider');
  });

  it('ignores invalid chat session records', () => {
    expect(ControlPlaneChatSessionPresenter.projectView({ id: 'missing-name' })).toEqual([]);
    expect(ControlPlaneChatSessionPresenter.projectView(null)).toEqual([]);
  });
});
