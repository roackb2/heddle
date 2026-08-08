import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { ClientSharedProxyApiService } from '@/client-shared/api/proxy.js';
import { AskCliV2CommandEdgeService } from '@/cli-v2/commands/ask-command.js';
import {
  ControlPlaneCommandRuntimeService,
  type ControlPlaneCommandRuntime,
} from '@/cli-v2/commands/control-plane-command-runtime.js';
import type { ResolvedRuntimeHost } from '@/core/runtime/daemon/index.js';

describe('AskCliV2CommandEdgeService', () => {
  it('creates a one-off session and submits the prompt through the control-plane API', async () => {
    const runtime = createRuntime();
    const resolve = vi.spyOn(ControlPlaneCommandRuntimeService, 'resolve').mockResolvedValue(runtime);
    const createClient = vi.spyOn(ClientSharedProxyApiService, 'createClient').mockReturnValue(createClientFixture({
      createSessionResult: {
        id: 'session-ask',
        name: 'Ask 2026-06-03T00:00:00.000Z',
        pinned: false,
        messageCount: 0,
        turnCount: 0,
        queuedPromptCount: 0,
      },
      sendPromptResult: {
        outcome: 'done',
        summary: 'API-backed answer.',
        session: {
          id: 'session-ask',
          name: 'Ask',
          pinned: false,
          messageCount: 2,
          turnCount: 1,
          queuedPromptCount: 0,
          messages: [],
          turns: [{
            id: 'turn-1',
            prompt: 'what is this project',
            outcome: 'done',
            summary: 'API-backed answer.',
            steps: 1,
            traceFile: '/repo/.heddle/traces/turn-1.json',
            events: [],
          }],
        },
      },
    }).client);
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    try {
      await AskCliV2CommandEdgeService.run('what is this project', defaultOptions());

      expect(resolve).toHaveBeenCalledWith(expect.objectContaining({
        workspaceRoot: '/repo',
        stateDir: '.heddle',
        heartbeatScheduler: { enabled: false },
      }));
      expect(createClient).toHaveBeenCalledWith(expect.objectContaining({ url: runtime.trpcUrl }));
      const client = createClient.mock.results[0]?.value as ReturnType<typeof createClientFixture>['client'];
      expect(client.controlPlane.sessionCreate.mutate).toHaveBeenCalledWith(expect.objectContaining({
        workspaceId: 'workspace-1',
        model: 'gpt-5.4',
        retention: 'one_off',
      }));
      expect(client.controlPlane.sessionSendPrompt.mutate).toHaveBeenCalledWith(expect.objectContaining({
        workspaceId: 'workspace-1',
        sessionId: 'session-ask',
        prompt: 'what is this project',
        maxSteps: 11,
        searchIgnoreDirs: ['node_modules'],
        systemContext: 'agent context',
        preferApiKey: true,
        includePlanTool: false,
        memoryMaintenanceMode: 'inline',
      }));
      expect(stdout).toHaveBeenCalledWith(expect.stringContaining('Session: session-ask'));
      expect(stdout).toHaveBeenCalledWith(expect.stringContaining('Trace: /repo/.heddle/traces/turn-1.json'));
      expect(runtime.close).toHaveBeenCalledTimes(1);
    } finally {
      resolve.mockRestore();
      createClient.mockRestore();
      stdout.mockRestore();
    }
  });

  it('continues the latest session without creating a new one', async () => {
    const runtime = createRuntime();
    const resolve = vi.spyOn(ControlPlaneCommandRuntimeService, 'resolve').mockResolvedValue(runtime);
    const fixture = createClientFixture({
      sessions: [{
        id: 'session-latest',
        name: 'Latest',
        pinned: false,
        messageCount: 1,
        turnCount: 1,
        queuedPromptCount: 0,
      }],
      sendPromptResult: {
        outcome: 'done',
        summary: 'Continued answer.',
        session: null,
      },
    });
    const createClient = vi.spyOn(ClientSharedProxyApiService, 'createClient').mockReturnValue(fixture.client);
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    try {
      await AskCliV2CommandEdgeService.run('continue this', {
        ...defaultOptions(),
        latestSession: true,
      });

      expect(fixture.client.controlPlane.sessions.query).toHaveBeenCalledWith({ workspaceId: 'workspace-1' });
      expect(fixture.client.controlPlane.sessionCreate.mutate).not.toHaveBeenCalled();
      expect(fixture.client.controlPlane.sessionSendPrompt.mutate).toHaveBeenCalledWith(expect.objectContaining({
        sessionId: 'session-latest',
        prompt: 'continue this',
      }));
    } finally {
      resolve.mockRestore();
      createClient.mockRestore();
      stdout.mockRestore();
    }
  });

  it('creates a reusable named session for --new-session', async () => {
    const runtime = createRuntime();
    const resolve = vi.spyOn(ControlPlaneCommandRuntimeService, 'resolve').mockResolvedValue(runtime);
    const fixture = createClientFixture({
      createSessionResult: {
        id: 'session-new',
        name: 'Review session',
        pinned: false,
        messageCount: 0,
        turnCount: 0,
        queuedPromptCount: 0,
      },
      sendPromptResult: {
        outcome: 'done',
        summary: 'New session answer.',
        session: null,
      },
    });
    const createClient = vi.spyOn(ClientSharedProxyApiService, 'createClient').mockReturnValue(fixture.client);
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    try {
      await AskCliV2CommandEdgeService.run('start review', {
        ...defaultOptions(),
        createSessionName: 'Review session',
      });

      expect(fixture.client.controlPlane.sessionCreate.mutate).toHaveBeenCalledWith(expect.objectContaining({
        name: 'Review session',
        retention: 'reusable',
      }));
    } finally {
      resolve.mockRestore();
      createClient.mockRestore();
      stdout.mockRestore();
    }
  });

  it('rejects conflicting session selection before starting a runtime', async () => {
    const resolve = vi.spyOn(ControlPlaneCommandRuntimeService, 'resolve');

    try {
      await expect(AskCliV2CommandEdgeService.run('conflicting ask', {
        ...defaultOptions(),
        sessionId: 'session-1',
        latestSession: true,
      })).rejects.toThrow('Choose only one of --session, --latest, or --new-session for heddle ask.');
      expect(resolve).not.toHaveBeenCalled();
    } finally {
      resolve.mockRestore();
    }
  });

  it('preserves multiline prompts read from a file', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-ask-prompt-file-'));
    const prompt = 'Inspect these files:\n\n- src/a.ts\n- src/b.ts\n';
    writeFileSync(join(workspaceRoot, 'prompt.md'), prompt, 'utf8');
    const runtime = createRuntime();
    const resolveRuntime = vi.spyOn(ControlPlaneCommandRuntimeService, 'resolve').mockResolvedValue(runtime);
    const fixture = createClientFixture({
      sendPromptResult: {
        outcome: 'done',
        summary: 'Inspected files.',
        session: null,
      },
    });
    const createClient = vi.spyOn(ClientSharedProxyApiService, 'createClient').mockReturnValue(fixture.client);
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    try {
      const result = await AskCliV2CommandEdgeService.run('', {
        ...defaultOptions(),
        workspaceRoot,
        promptFile: 'prompt.md',
      });

      expect(result).toEqual({ exitCode: 0 });
      expect(fixture.client.controlPlane.sessionSendPrompt.mutate).toHaveBeenCalledWith(expect.objectContaining({
        prompt,
      }));
    } finally {
      resolveRuntime.mockRestore();
      createClient.mockRestore();
      stdout.mockRestore();
    }
  });

  it('streams one versioned JSONL record sequence for an exact accepted run', async () => {
    const runtime = createRuntime();
    const resolveRuntime = vi.spyOn(ControlPlaneCommandRuntimeService, 'resolve').mockResolvedValue(runtime);
    const fixture = createClientFixture({
      sendPromptResult: {
        outcome: 'done',
        summary: 'Unused synchronous result.',
        session: null,
      },
      sendPromptAsyncResult: {
        accepted: true,
        workspaceId: 'workspace-1',
        sessionId: 'session-created',
        runId: 'run-jsonl',
        acceptedAt: '2026-06-03T00:00:00.000Z',
      },
      runEvents: [
        {
          kind: 'activity',
          runId: 'run-jsonl',
          sequence: 1,
          timestamp: '2026-06-03T00:00:01.000Z',
          activity: {
            type: 'assistant.commentary',
            runId: 'run-jsonl',
            source: 'agent-loop',
            step: 1,
            messageId: 'commentary-1',
            text: 'Inspecting repository.',
            done: true,
            timestamp: '2026-06-03T00:00:01.000Z',
          },
        },
        {
          kind: 'result',
          runId: 'run-jsonl',
          sequence: 2,
          timestamp: '2026-06-03T00:00:02.000Z',
          result: {
            outcome: 'done',
            summary: 'Done.',
            traceFile: '/workspace/.heddle/traces/trace-1.json',
            changedFiles: [{ path: 'src/a.ts', status: 'modified', source: 'edit_file' }],
          },
        },
      ],
    });
    const createClient = vi.spyOn(ClientSharedProxyApiService, 'createClient').mockReturnValue(fixture.client);
    const stdoutLines: string[] = [];
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdoutLines.push(String(chunk));
      return true;
    });
    const prompt = 'Inspect these files:\n\n- src/a.ts\n- src/b.ts\n';

    try {
      const result = await AskCliV2CommandEdgeService.run('', {
        ...defaultOptions(),
        output: 'jsonl',
        promptFile: '-',
        stdin: Readable.from(['Inspect these files:\n\n', '- src/a.ts\n', '- src/b.ts\n']),
      });

      expect(result).toEqual({ exitCode: 0 });
      expect(fixture.client.controlPlane.sessionSendPromptAsync.mutate).toHaveBeenCalledWith(expect.objectContaining({
        prompt,
        queueIfBusy: false,
      }));
      expect(fixture.client.controlPlane.sessionSendPrompt.mutate).not.toHaveBeenCalled();
      const records = stdoutLines.map((line) => JSON.parse(line));
      expect(records.map((record) => record.type)).toEqual([
        'run.accepted',
        'run.activity',
        'run.result',
      ]);
      expect(records.every((record) => record.schemaVersion === 1)).toBe(true);
      expect(records.filter((record) => record.terminal)).toHaveLength(1);
      expect(records[1]).toMatchObject({
        runId: 'run-jsonl',
        sequence: 1,
        activity: { text: 'Inspecting repository.' },
      });
      expect(records[2]).toMatchObject({
        result: {
          traceFile: '/workspace/.heddle/traces/trace-1.json',
          changedFiles: [{ path: 'src/a.ts', status: 'modified', source: 'edit_file' }],
        },
      });
      expect(stderr).toHaveBeenCalledWith(expect.stringContaining('ask'));
    } finally {
      resolveRuntime.mockRestore();
      createClient.mockRestore();
      stdout.mockRestore();
      stderr.mockRestore();
    }
  });

  it('emits one terminal command error for invalid JSONL input', async () => {
    const resolveRuntime = vi.spyOn(ControlPlaneCommandRuntimeService, 'resolve');
    const stdoutLines: string[] = [];
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdoutLines.push(String(chunk));
      return true;
    });

    try {
      const result = await AskCliV2CommandEdgeService.run('positional prompt', {
        ...defaultOptions(),
        output: 'jsonl',
        promptFile: 'prompt.md',
      });

      expect(result).toEqual({ exitCode: 1 });
      expect(resolveRuntime).not.toHaveBeenCalled();
      expect(stdoutLines).toHaveLength(1);
      expect(JSON.parse(stdoutLines[0] ?? '')).toMatchObject({
        schemaVersion: 1,
        type: 'command.error',
        terminal: true,
        error: {
          code: 'ASK_COMMAND_FAILED',
          message: 'Usage: pass either a positional goal or --prompt-file, not both.',
        },
      });
    } finally {
      resolveRuntime.mockRestore();
      stdout.mockRestore();
    }
  });
});

function defaultOptions() {
  return {
    workspaceRoot: '/repo',
    activeWorkspaceId: 'workspace-1',
    model: 'gpt-5.4',
    maxSteps: 11,
    preferApiKey: true,
    stateDir: '.heddle',
    searchIgnoreDirs: ['node_modules'],
    systemContext: 'agent context',
    runtimeHost: {
      kind: 'none' as const,
      registryPath: '/registry.json',
    },
  };
}

function createRuntime(): ControlPlaneCommandRuntime {
  return {
    kind: 'attached',
    trpcUrl: 'http://127.0.0.1:8765/trpc',
    endpoint: {
      host: '127.0.0.1',
      port: 8765,
    },
    serverId: 'server-1',
    close: vi.fn(async () => undefined),
  };
}

function createClientFixture(input: {
  sessions?: unknown[];
  createSessionResult?: unknown;
  sendPromptResult: unknown;
  sendPromptAsyncResult?: unknown;
  runEvents?: unknown[];
}) {
  const client = {
    controlPlane: {
      state: {
        query: vi.fn(async () => ({ activeWorkspaceId: 'workspace-1' })),
      },
      sessions: {
        query: vi.fn(async () => ({
          workspaceId: 'workspace-1',
          sessions: input.sessions ?? [],
        })),
      },
      sessionCreate: {
        mutate: vi.fn(async () => input.createSessionResult ?? {
          id: 'session-created',
          name: 'Created',
          pinned: false,
          messageCount: 0,
          turnCount: 0,
          queuedPromptCount: 0,
        }),
      },
      sessionSendPrompt: {
        mutate: vi.fn(async () => input.sendPromptResult),
      },
      sessionSendPromptAsync: {
        mutate: vi.fn(async () => input.sendPromptAsyncResult),
      },
      sessionRunEvents: {
        subscribe: vi.fn((_input, handlers) => {
          handlers.onStarted?.();
          queueMicrotask(() => {
            for (const event of input.runEvents ?? []) {
              handlers.onData?.(event);
            }
            handlers.onComplete?.();
          });
          return { unsubscribe: vi.fn() };
        }),
      },
    },
  };

  return {
    client: client as never,
  };
}

const freshRuntimeHost: ResolvedRuntimeHost = {
  kind: 'server',
  registryPath: '/registry.json',
  serverId: 'server-1',
  mode: 'daemon',
  endpoint: {
    host: '127.0.0.1',
    port: 8765,
  },
  startedAt: '2026-06-03T00:00:00.000Z',
  lastSeenAt: '2026-06-03T00:00:01.000Z',
  stale: false,
  ageMs: 100,
};

void freshRuntimeHost;
