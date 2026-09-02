import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, parse } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  WorkingSetCheckpointCaptureError,
  WorkingSetCheckpointCodec,
  WorkingSetCheckpointConfigurationError,
  WorkingSetCheckpointConflictError,
  WorkingSetCheckpointCorruptionError,
  WorkingSetCheckpointGenerationIdSchema,
  WorkingSetCheckpointService,
  deriveWorkingSetScopeId,
  type CommitWorkingSetCheckpointInput,
  type LoadWorkingSetCheckpointGenerationInput,
  type WorkingSetCheckpointGeneration,
  type WorkingSetCheckpointGenerationId,
  type WorkingSetCheckpointManifest,
  type WorkingSetCheckpointStore,
  type WorkingSetScopeId,
} from '@/core/working-set/index.js';

const GENEROUS_LIMITS = {
  maxFileCount: 20,
  maxFileBytes: 1024,
  maxTotalBytes: 4096,
};

const scopeA = deriveWorkingSetScopeId({
  adopterId: 'adopter-a',
  tenantId: 'tenant-a',
  subjectId: 'subject-a',
  productSessionId: 'agent-a',
});

const scopeB = deriveWorkingSetScopeId({
  adopterId: 'adopter-a',
  tenantId: 'tenant-a',
  subjectId: 'subject-a',
  productSessionId: 'agent-b',
});

class InMemoryWorkingSetCheckpointStore implements WorkingSetCheckpointStore {
  readonly manifests = new Map<WorkingSetScopeId, WorkingSetCheckpointManifest>();
  readonly generations = new Map<string, WorkingSetCheckpointGeneration>();
  forcedActualGenerationId: WorkingSetCheckpointGenerationId | undefined;
  throwAfterNextCommit = false;

  async loadManifest(scopeId: WorkingSetScopeId): Promise<unknown | undefined> {
    const manifest = this.manifests.get(scopeId);
    return manifest ? structuredClone(manifest) : undefined;
  }

  async loadGeneration(input: LoadWorkingSetCheckpointGenerationInput): Promise<unknown | undefined> {
    const generation = this.generations.get(this.generationKey(input.scopeId, input.generationId));
    return generation ? structuredClone(generation) : undefined;
  }

  async commit(input: CommitWorkingSetCheckpointInput): Promise<void> {
    const scopeId = input.manifest.scopeId;
    const actualGenerationId = this.forcedActualGenerationId
      ?? this.manifests.get(scopeId)?.generationId
      ?? null;
    this.forcedActualGenerationId = undefined;
    if (actualGenerationId !== input.expectedGenerationId) {
      throw new WorkingSetCheckpointConflictError(
        scopeId,
        input.expectedGenerationId,
        actualGenerationId,
      );
    }

    this.generations.set(
      this.generationKey(scopeId, input.generation.generationId),
      structuredClone(input.generation),
    );
    this.manifests.set(scopeId, structuredClone(input.manifest));

    if (this.throwAfterNextCommit) {
      this.throwAfterNextCommit = false;
      throw new Error('connection lost after commit');
    }
  }

  generation(scopeId: WorkingSetScopeId, generationId: WorkingSetCheckpointGenerationId) {
    return this.generations.get(this.generationKey(scopeId, generationId));
  }

  private generationKey(
    scopeId: WorkingSetScopeId,
    generationId: WorkingSetCheckpointGenerationId,
  ): string {
    return `${scopeId}:${generationId}`;
  }
}

describe('WorkingSetCheckpointService', () => {
  const temporaryRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })));
  });

  it('derives stable isolated scopes and addresses store reads by the exact scope', async () => {
    const fixture = await createFixture();
    const store = new InMemoryWorkingSetCheckpointStore();
    const service = createService(fixture.workingRoot, store);

    expect(scopeA).toBe(deriveWorkingSetScopeId({
      adopterId: 'adopter-a',
      tenantId: 'tenant-a',
      subjectId: 'subject-a',
      productSessionId: 'agent-a',
    }));
    expect(scopeB).not.toBe(scopeA);

    await service.checkpoint(scopeA);
    await expect(service.load(scopeA)).resolves.toBeDefined();
    await expect(service.load(scopeB)).resolves.toBeUndefined();
  });

  it('rejects a store response from another scope', async () => {
    const fixture = await createFixture();
    const store = new InMemoryWorkingSetCheckpointStore();
    const service = createService(fixture.workingRoot, store);
    const manifest = await service.checkpoint(scopeA);
    store.manifests.set(scopeB, structuredClone(manifest));

    await expect(service.load(scopeB)).rejects.toMatchObject({
      code: 'WORKING_SET_CHECKPOINT_CORRUPTION',
      scopeId: scopeB,
      detail: expect.stringContaining('manifest scope mismatch'),
    });
  });

  it('requires an absolute dedicated root instead of resolving a risky path implicitly', () => {
    const store = new InMemoryWorkingSetCheckpointStore();
    const options = {
      limits: GENEROUS_LIMITS,
      resetLocalWorkingCopy: async () => undefined,
    };

    expect(() => new WorkingSetCheckpointService('working', store, options))
      .toThrow(WorkingSetCheckpointConfigurationError);
    expect(() => new WorkingSetCheckpointService(parse(process.cwd()).root, store, options))
      .toThrow(WorkingSetCheckpointConfigurationError);
  });

  it('creates a canonical generation and validates manifest integrity', async () => {
    const fixture = await createFixture();
    const store = new InMemoryWorkingSetCheckpointStore();
    const service = createService(fixture.workingRoot, store);
    await writeFile(join(fixture.workingRoot, 'z-last.md'), 'last');
    await writeFile(join(fixture.workingRoot, 'a-first.md'), 'first');

    const manifest = await service.checkpoint(scopeA);
    const generation = store.generation(scopeA, manifest.generationId);
    if (!generation) {
      throw new Error('Expected a committed test generation.');
    }

    expect(generation.files.map(file => file.path)).toEqual([
      'NOW.md',
      'a-first.md',
      'notes/research.md',
      'z-last.md',
    ]);
    expect(WorkingSetCheckpointCodec.serializeGeneration(generation)).toContain(
      '"kind": "heddle-working-set-checkpoint-generation"',
    );
    expect(() => WorkingSetCheckpointCodec.validateCommitted(
      { ...manifest, generationSha256: '0'.repeat(64) },
      generation,
    )).toThrow(WorkingSetCheckpointCorruptionError);
  });

  it('enforces explicit capture bounds', async () => {
    const fixture = await createFixture();
    const service = createService(
      fixture.workingRoot,
      new InMemoryWorkingSetCheckpointStore(),
      { maxFileCount: 20, maxFileBytes: 4, maxTotalBytes: 4096 },
    );

    await expect(service.checkpoint(scopeA)).rejects.toBeInstanceOf(WorkingSetCheckpointCaptureError);
  });

  it('surfaces compare-and-swap conflicts instead of replacing another writer', async () => {
    const fixture = await createFixture();
    const store = new InMemoryWorkingSetCheckpointStore();
    const service = createService(fixture.workingRoot, store);
    store.forcedActualGenerationId = WorkingSetCheckpointGenerationIdSchema.parse('competing-generation');

    await expect(service.checkpoint(scopeA)).rejects.toMatchObject({
      code: 'WORKING_SET_CHECKPOINT_CONFLICT',
      expectedGenerationId: null,
      actualGenerationId: 'competing-generation',
    });
    expect(store.manifests.has(scopeA)).toBe(false);
  });

  it('initializes a clean empty directory when durable state is absent', async () => {
    const fixture = await createFixture();
    const service = createService(fixture.workingRoot, new InMemoryWorkingSetCheckpointStore());

    await expect(service.prepareOrRecover(scopeA)).resolves.toEqual({
      status: 'initialized-empty',
      workingRoot: fixture.workingRoot,
    });
    await expect(readdir(fixture.workingRoot)).resolves.toEqual([]);
  });

  it('discards a populated dirty local copy and restores only the committed generation', async () => {
    const fixture = await createFixture();
    const store = new InMemoryWorkingSetCheckpointStore();
    const service = createService(fixture.workingRoot, store);
    const manifest = await service.checkpoint(scopeA);

    await writeFile(join(fixture.workingRoot, 'NOW.md'), '# Uncommitted focus\n');
    await writeFile(join(fixture.workingRoot, 'failed-run.tmp'), 'partial output');

    await expect(service.prepareOrRecover(scopeA)).resolves.toMatchObject({
      status: 'restored-committed',
      manifest: { generationId: manifest.generationId },
    });
    await expect(readFile(join(fixture.workingRoot, 'NOW.md'), 'utf8'))
      .resolves.toBe('# Current focus\n');
    await expect(stat(join(fixture.workingRoot, 'failed-run.tmp'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('validates corrupt durable state before invoking the privileged local reset', async () => {
    const fixture = await createFixture();
    const store = new InMemoryWorkingSetCheckpointStore();
    let resetCount = 0;
    const service = createService(fixture.workingRoot, store, GENEROUS_LIMITS, async () => {
      resetCount += 1;
      await rm(fixture.workingRoot, { recursive: true, force: true });
    });
    const manifest = await service.checkpoint(scopeA);
    const generation = store.generation(scopeA, manifest.generationId);
    if (!generation) {
      throw new Error('Expected a committed test generation.');
    }
    generation.files[0] = { ...generation.files[0], contentBase64: 'Y29ycnVwdA==' };
    await writeFile(join(fixture.workingRoot, 'dirty-local.txt'), 'must remain');

    await expect(service.prepareOrRecover(scopeA)).rejects.toBeInstanceOf(
      WorkingSetCheckpointCorruptionError,
    );
    expect(resetCount).toBe(0);
    await expect(readFile(join(fixture.workingRoot, 'dirty-local.txt'), 'utf8'))
      .resolves.toBe('must remain');
  });

  it('fails closed when the host reset leaves a populated target', async () => {
    const fixture = await createFixture();
    const service = createService(
      fixture.workingRoot,
      new InMemoryWorkingSetCheckpointStore(),
      GENEROUS_LIMITS,
      async () => undefined,
    );

    await expect(service.prepareOrRecover(scopeA)).rejects.toMatchObject({
      code: 'WORKING_SET_CHECKPOINT_RECOVERY_ERROR',
      detail: 'host reset did not leave an absent or empty working root',
    });
    await expect(readFile(join(fixture.workingRoot, 'NOW.md'), 'utf8'))
      .resolves.toBe('# Current focus\n');
  });

  it('reloads authority after an ambiguous commit response and can checkpoint again', async () => {
    const fixture = await createFixture();
    const store = new InMemoryWorkingSetCheckpointStore();
    const generationIds = ['generation-1', 'generation-2']
      .map(value => WorkingSetCheckpointGenerationIdSchema.parse(value));
    const service = createService(
      fixture.workingRoot,
      store,
      GENEROUS_LIMITS,
      undefined,
      generationIds,
    );
    store.throwAfterNextCommit = true;

    await expect(service.checkpoint(scopeA)).rejects.toThrow('connection lost after commit');
    await expect(service.load(scopeA)).resolves.toMatchObject({
      manifest: { generationId: 'generation-1' },
    });

    await writeFile(join(fixture.workingRoot, 'NOW.md'), '# Next focus\n');
    await expect(service.checkpoint(scopeA)).resolves.toMatchObject({ generationId: 'generation-2' });
    await expect(service.prepareOrRecover(scopeA)).resolves.toMatchObject({
      status: 'restored-committed',
      manifest: { generationId: 'generation-2' },
    });
    await expect(readFile(join(fixture.workingRoot, 'NOW.md'), 'utf8'))
      .resolves.toBe('# Next focus\n');
  });

  async function createFixture(): Promise<{ workingRoot: string }> {
    const root = await mkdtemp(join(tmpdir(), 'heddle-working-set-checkpoint-'));
    temporaryRoots.push(root);
    const workingRoot = join(root, 'working');
    await mkdir(join(workingRoot, 'notes'), { recursive: true });
    await writeFile(join(workingRoot, 'NOW.md'), '# Current focus\n');
    await writeFile(join(workingRoot, 'notes/research.md'), '# Research\n');
    return { workingRoot };
  }
});

function createService(
  workingRoot: string,
  store: WorkingSetCheckpointStore,
  limits = GENEROUS_LIMITS,
  resetLocalWorkingCopy: (() => Promise<void>) | undefined = undefined,
  generationIds: WorkingSetCheckpointGenerationId[] = [],
): WorkingSetCheckpointService {
  let generatedId = 0;
  return new WorkingSetCheckpointService(workingRoot, store, {
    limits,
    resetLocalWorkingCopy: resetLocalWorkingCopy
      ?? (() => rm(workingRoot, { recursive: true, force: true })),
    now: () => new Date('2026-09-02T00:00:00.000Z'),
    createGenerationId: () => generationIds.shift()
      ?? WorkingSetCheckpointGenerationIdSchema.parse(`generation-${generatedId += 1}`),
  });
}
