import { mkdtempSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AskCliV2CommandEdgeService } from '@/cli-v2/commands/ask-command.js';
import { FileChatSessionRepository } from '@/core/chat/engine/sessions/repository/index.js';
import { listStoredChatSessions } from '@/__tests__/helpers/chat-session-repository.js';
import type { ResolvedRuntimeHost } from '@/core/runtime/daemon/index.js';
import { RuntimeWorkspaceService } from '@/core/runtime/workspaces/index.js';
import { createHeddleServerApp } from '@/server/app.js';

describe('AskCliV2CommandEdgeService integration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('submits ask through an attached control-plane server and persists the shared session', async () => {
    vi.stubEnv('HEDDLE_BROWSER_INTEGRATION_FAKE_AGENT', '1');
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-ask-cli-v2-'));
    const stateRoot = join(workspaceRoot, '.heddle');
    const workspace = RuntimeWorkspaceService.resolveContext({
      workspaceRoot,
      stateRoot,
    }).activeWorkspace;
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const server = createHeddleServerApp({ workspaceRoot, stateRoot }).listen(0, '127.0.0.1');
    await onceListening(server);
    const address = server.address() as AddressInfo;
    const runtimeHost: ResolvedRuntimeHost = {
      kind: 'server',
      registryPath: join(workspaceRoot, 'daemon-registry.json'),
      serverId: 'server-ask-test',
      mode: 'daemon',
      endpoint: { host: '127.0.0.1', port: address.port },
      startedAt: '2026-06-03T00:00:00.000Z',
      lastSeenAt: '2026-06-03T00:00:01.000Z',
      stale: false,
      ageMs: 100,
    };

    try {
      const result = await AskCliV2CommandEdgeService.run('describe this workspace', {
        workspaceRoot,
        activeWorkspaceId: workspace.id,
        model: 'gpt-5.4',
        maxSteps: 7,
        preferApiKey: false,
        stateDir: '.heddle',
        runtimeHost,
      });
      expect(result).toEqual({ exitCode: 0 });
    } finally {
      await closeServer(server);
    }

    const sessions = await listStoredChatSessions(new FileChatSessionRepository({
      sessionStoragePath: join(stateRoot, 'chat-sessions.catalog.json'),
    }));
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      retention: 'one_off',
      workspaceId: workspace.id,
      lastContinuePrompt: 'describe this workspace',
    });
    expect(sessions[0]?.history.at(-1)).toMatchObject({
      role: 'assistant',
      content: 'Mocked browser integration agent response: describe this workspace',
    });
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining(`Session: ${sessions[0]?.id}`));
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining('Outcome: done'));
  });

  it('streams an accepted run and one terminal result as JSONL', async () => {
    vi.stubEnv('HEDDLE_BROWSER_INTEGRATION_FAKE_AGENT', '1');
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-ask-cli-v2-jsonl-'));
    const stateRoot = join(workspaceRoot, '.heddle');
    const workspace = RuntimeWorkspaceService.resolveContext({
      workspaceRoot,
      stateRoot,
    }).activeWorkspace;
    const stdoutLines: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdoutLines.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const server = createHeddleServerApp({ workspaceRoot, stateRoot }).listen(0, '127.0.0.1');
    await onceListening(server);
    const address = server.address() as AddressInfo;
    const runtimeHost: ResolvedRuntimeHost = {
      kind: 'server',
      registryPath: join(workspaceRoot, 'daemon-registry.json'),
      serverId: 'server-ask-jsonl-test',
      mode: 'daemon',
      endpoint: { host: '127.0.0.1', port: address.port },
      startedAt: '2026-06-03T00:00:00.000Z',
      lastSeenAt: '2026-06-03T00:00:01.000Z',
      stale: false,
      ageMs: 100,
    };

    try {
      const result = await AskCliV2CommandEdgeService.run('describe this workspace', {
        workspaceRoot,
        activeWorkspaceId: workspace.id,
        model: 'gpt-5.4',
        maxSteps: 7,
        preferApiKey: false,
        stateDir: '.heddle',
        runtimeHost,
        output: 'jsonl',
      });
      expect(result).toEqual({ exitCode: 0 });
    } finally {
      await closeServer(server);
    }

    const records = stdoutLines.map((line) => JSON.parse(line));
    expect(records[0]).toMatchObject({
      schemaVersion: 1,
      type: 'run.accepted',
      terminal: false,
      workspaceId: workspace.id,
    });
    expect(records.some((record) => record.type === 'run.activity')).toBe(true);
    expect(records.at(-1)).toMatchObject({
      schemaVersion: 1,
      type: 'run.result',
      terminal: true,
      result: { outcome: 'done' },
    });
    expect(records.filter((record) => record.terminal)).toHaveLength(1);
  });
});

async function onceListening(server: { once: (event: 'listening', listener: () => void) => void; listening?: boolean }) {
  if (server.listening) {
    return;
  }

  await new Promise<void>((resolve) => {
    server.once('listening', resolve);
  });
}

async function closeServer(server: { close: (listener: (error?: Error) => void) => void }) {
  await new Promise<void>((resolve, reject) => {
    server.close((error?: Error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
