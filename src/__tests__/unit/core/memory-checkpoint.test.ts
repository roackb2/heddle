import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MemoryCheckpointConflictError,
  MemoryCheckpointCorruptionError,
  MemoryCheckpointGenerationIdSchema,
  MemoryCheckpointGenerationSchema,
  MemoryCheckpointRestoreTargetError,
  MemoryCheckpointService,
  type CommitMemoryCheckpointInput,
  type DeleteMemoryCheckpointInput,
  type LoadMemoryCheckpointGenerationInput,
  type MemoryCheckpointGeneration,
  type MemoryCheckpointManifest,
  type MemoryCheckpointStore,
} from '@/core/memory/checkpoint/index.js';
import { deriveMemoryScopeId } from '@/core/memory/scope.js';

const scopeId = deriveMemoryScopeId({
  adopterId: 'lucid',
  tenantId: 'tenant-a',
  subjectId: 'user-a',
  owner: { kind: 'agent', id: 'agent-a' },
});

class InMemoryCheckpointStore implements MemoryCheckpointStore {
  manifest: MemoryCheckpointManifest | undefined;
  readonly generations = new Map<string, MemoryCheckpointGeneration>();

  async loadManifest(): Promise<unknown | undefined> {
    return this.manifest ? structuredClone(this.manifest) : undefined;
  }

  async loadGeneration(input: LoadMemoryCheckpointGenerationInput): Promise<unknown | undefined> {
    const generation = this.generations.get(input.generationId);
    return generation ? structuredClone(generation) : undefined;
  }

  async commit(input: CommitMemoryCheckpointInput): Promise<void> {
    const actualGenerationId = this.manifest?.generationId ?? null;
    if (actualGenerationId !== input.expectedGenerationId) {
      throw new MemoryCheckpointConflictError(
        input.manifest.scopeId,
        input.expectedGenerationId,
        actualGenerationId,
      );
    }

    this.generations.set(input.generation.generationId, structuredClone(input.generation));
    this.manifest = structuredClone(input.manifest);
  }

  async delete(input: DeleteMemoryCheckpointInput): Promise<void> {
    const actualGenerationId = this.manifest?.generationId ?? null;
    if (actualGenerationId !== input.expectedGenerationId) {
      throw new MemoryCheckpointConflictError(
        input.scopeId,
        input.expectedGenerationId,
        actualGenerationId,
      );
    }
    this.manifest = undefined;
  }
}

describe('MemoryCheckpointService', () => {
  const temporaryRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })));
  });

  it('round-trips only allowlisted memory files through a committed generation', async () => {
    const fixture = await createFixture();
    const store = new InMemoryCheckpointStore();
    const service = createService(fixture.memoryRoot, store);

    const manifest = await service.checkpoint(scopeId);
    const generation = MemoryCheckpointGenerationSchema.parse(
      await store.loadGeneration({ scopeId, generationId: manifest.generationId }),
    );

    expect(generation.files.map(file => file.path)).toEqual([
      'README.md',
      '_maintenance/candidates.jsonl',
      '_maintenance/runs.jsonl',
      'preferences/music.md',
    ]);

    await rm(fixture.memoryRoot, { recursive: true });
    await expect(service.restore(scopeId)).resolves.toMatchObject({
      status: 'restored',
      manifest: { generationId: manifest.generationId },
    });
    await expect(readFile(join(fixture.memoryRoot, 'preferences/music.md'), 'utf8'))
      .resolves.toBe('# Music\nAmbient and post-rock.\n');
    await expect(stat(join(fixture.memoryRoot, '_maintenance/maintenance.lock'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(join(fixture.memoryRoot, 'credentials.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects corrupt durable content before creating a local working copy', async () => {
    const fixture = await createFixture();
    const store = new InMemoryCheckpointStore();
    const service = createService(fixture.memoryRoot, store);
    const manifest = await service.checkpoint(scopeId);
    const generation = store.generations.get(manifest.generationId);
    if (!generation) {
      throw new Error('Expected test checkpoint generation.');
    }
    generation.files[0] = { ...generation.files[0], contentBase64: 'Y29ycnVwdA==' };

    await rm(fixture.memoryRoot, { recursive: true });
    await expect(service.restore(scopeId)).rejects.toBeInstanceOf(MemoryCheckpointCorruptionError);
    await expect(stat(fixture.memoryRoot)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not merge into an existing working copy and deletes by committed generation', async () => {
    const fixture = await createFixture();
    const store = new InMemoryCheckpointStore();
    const service = createService(fixture.memoryRoot, store);
    await service.checkpoint(scopeId);

    await expect(service.restore(scopeId)).rejects.toBeInstanceOf(MemoryCheckpointRestoreTargetError);
    await expect(readFile(join(fixture.memoryRoot, 'README.md'), 'utf8')).resolves.toBe('# Memory\n');
    await expect(service.delete(scopeId)).resolves.toBe(true);
    await expect(service.delete(scopeId)).resolves.toBe(false);
  });

  async function createFixture(): Promise<{ memoryRoot: string }> {
    const root = await mkdtemp(join(tmpdir(), 'heddle-memory-checkpoint-'));
    temporaryRoots.push(root);
    const memoryRoot = join(root, 'memory');
    await mkdir(join(memoryRoot, 'preferences'), { recursive: true });
    await mkdir(join(memoryRoot, '_maintenance'), { recursive: true });
    await writeFile(join(memoryRoot, 'README.md'), '# Memory\n');
    await writeFile(join(memoryRoot, 'preferences/music.md'), '# Music\nAmbient and post-rock.\n');
    await writeFile(join(memoryRoot, '_maintenance/candidates.jsonl'), '{"id":"candidate-a"}\n');
    await writeFile(join(memoryRoot, '_maintenance/runs.jsonl'), '{"id":"run-a"}\n');
    await writeFile(join(memoryRoot, '_maintenance/maintenance.lock'), '{"pid":1}\n');
    await writeFile(join(memoryRoot, 'credentials.json'), '{"token":"secret"}\n');
    return { memoryRoot };
  }

  function createService(memoryRoot: string, store: MemoryCheckpointStore): MemoryCheckpointService {
    return new MemoryCheckpointService(memoryRoot, store, {
      now: () => new Date('2026-08-26T00:00:00.000Z'),
      createGenerationId: () => MemoryCheckpointGenerationIdSchema.parse('generation-1'),
    });
  }
});
