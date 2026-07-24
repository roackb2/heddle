import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ChatArchiveRepositoryConformance,
  ChatArchiveRepositoryConformanceError,
  FileChatArchiveRepository,
  type ChatArchiveRepositoryConformanceHarness,
} from '@/core/chat/engine/sessions/archives/index.js';

describe('ChatArchiveRepositoryConformance', () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'heddle-archive-conformance-'));
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const stateRoot = (scopeId: string) => join(root, scopeId);

  const harness: ChatArchiveRepositoryConformanceHarness = {
    createRepository: (scopeId) => new FileChatArchiveRepository({
      stateRoot: stateRoot(scopeId),
    }),
    cleanupScope: async (scopeId) => {
      await rm(stateRoot(scopeId), { recursive: true, force: true });
    },
    corruptManifest: async ({ scopeId, sessionId }) => {
      const repository = new FileChatArchiveRepository({
        stateRoot: stateRoot(scopeId),
      });
      const paths = repository.deriveStoragePaths(sessionId);
      await mkdir(paths.archivesDir, { recursive: true });
      await writeFile(paths.manifestPath, '{"version":');
    },
  };

  const scenarios = ChatArchiveRepositoryConformance.createScenarios(harness);

  it('publishes six uniquely named scenarios', () => {
    expect(scenarios).toHaveLength(6);
    expect(new Set(scenarios.map((scenario) => scenario.name)).size).toBe(6);
  });

  it.each(scenarios)('$name', async ({ run }) => {
    await run();
  });

  it('cleans every generated scope when an adapter operation fails', async () => {
    const cleanedScopes: string[] = [];
    const failingHarness: ChatArchiveRepositoryConformanceHarness = {
      createRepository: () => {
        throw new Error('adapter unavailable');
      },
      cleanupScope: (scopeId) => {
        cleanedScopes.push(scopeId);
      },
      corruptManifest: () => undefined,
    };
    const [scenario] = ChatArchiveRepositoryConformance.createScenarios(failingHarness);

    await expect(scenario?.run()).rejects.toBeInstanceOf(
      ChatArchiveRepositoryConformanceError,
    );
    expect(cleanedScopes).toHaveLength(1);
    expect(cleanedScopes[0]).toMatch(/^[0-9a-f-]{36}$/u);
  });
});
