import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ChatSessionRepositoryConformance,
  ChatSessionRepositoryConformanceError,
  FileChatSessionRepository,
  type ChatSessionRepositoryConformanceHarness,
} from '../../../core/chat/engine/sessions/repository/index.js';

describe('ChatSessionRepositoryConformance', () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'heddle-session-conformance-'));
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const storagePath = (scopeId: string) =>
    join(root, scopeId, 'chat-sessions.catalog.json');

  const harness: ChatSessionRepositoryConformanceHarness = {
    createRepository: (scopeId) => new FileChatSessionRepository({
      sessionStoragePath: storagePath(scopeId),
    }),
    cleanupScope: async (scopeId) => {
      await rm(join(root, scopeId), { recursive: true, force: true });
    },
    corruptSessionRecord: async ({ scopeId, sessionId }) => {
      const repository = new FileChatSessionRepository({
        sessionStoragePath: storagePath(scopeId),
      });
      const stored = await repository.read(sessionId);
      if (!stored) {
        throw new Error(`Cannot corrupt missing test session: ${sessionId}`);
      }
      const paths = repository.deriveStoragePaths();
      await writeFile(
        join(paths.sessionsDir, `${encodeURIComponent(sessionId)}.${stored.revision}.json`),
        '{"id":',
      );
    },
  };

  const scenarios = ChatSessionRepositoryConformance.createScenarios(harness);

  it('publishes eight uniquely named scenarios', () => {
    expect(scenarios).toHaveLength(8);
    expect(new Set(scenarios.map((scenario) => scenario.name)).size).toBe(8);
  });

  it.each(scenarios)('$name', async ({ run }) => {
    await run();
  });

  it('cleans every generated scope when an adapter operation fails', async () => {
    const cleanedScopes: string[] = [];
    const failingHarness: ChatSessionRepositoryConformanceHarness = {
      createRepository: () => {
        throw new Error('adapter unavailable');
      },
      cleanupScope: (scopeId) => {
        cleanedScopes.push(scopeId);
      },
      corruptSessionRecord: () => undefined,
    };
    const [scenario] = ChatSessionRepositoryConformance.createScenarios(failingHarness);

    await expect(scenario?.run()).rejects.toBeInstanceOf(
      ChatSessionRepositoryConformanceError,
    );
    expect(cleanedScopes).toHaveLength(1);
    expect(cleanedScopes[0]).toMatch(/^[0-9a-f-]{36}$/u);
  });
});
