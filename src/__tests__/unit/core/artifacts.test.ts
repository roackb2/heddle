import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ArtifactService, FileArtifactRepository } from '@/core/artifacts/index.js';
import type { ArtifactRepository, ArtifactStore } from '@/core/artifacts/index.js';

/** Non-file ArtifactRepository proving the port is not shaped around the filesystem. */
function createInMemoryArtifactRepository(): ArtifactRepository & { contents: Map<string, string> } {
  let catalog: ArtifactStore = FileArtifactRepository.emptyStore();
  const contents = new Map<string, string>();

  return {
    contents,
    readCatalog: () => structuredClone(catalog),
    writeCatalog: (store) => {
      catalog = structuredClone(store);
    },
    contentKey: (id, extension) => `memory://${id}.${extension}`,
    contentExists: (key) => contents.has(key),
    writeContent: (key, content) => {
      contents.set(key, content);
    },
    readContent: (key) => contents.get(key),
  };
}

describe('artifact registry', () => {
  it('saves text artifacts, stores metadata, and reads content back', () => {
    const artifactRoot = mkdtempSync(join(tmpdir(), 'heddle-artifacts-'));
    const service = new ArtifactService({
      artifactRoot,
      now: () => '2026-07-01T00:00:00.000Z',
      nextId: () => 'deck-source',
    });

    const artifact = service.saveText({
      kind: 'source',
      domain: 'presentation',
      title: 'deck.motion.md',
      content: '# Deck\n\n<Slide />',
      sessionId: 'session-1',
      turnId: 'turn-1',
      sourceTool: 'host_generate_document',
      metadata: { slideCount: 1 },
    });

    expect(artifact).toMatchObject({
      id: 'deck-source',
      kind: 'source',
      domain: 'presentation',
      title: 'deck.motion.md',
      sessionId: 'session-1',
      turnId: 'turn-1',
      sourceTool: 'host_generate_document',
      metadata: { slideCount: 1 },
    });
    expect(artifact.path).toBe(join(artifactRoot, 'files', 'deck-source.md'));
    expect(readFileSync(artifact.path, 'utf8')).toBe('# Deck\n\n<Slide />');
    expect(service.read('deck-source')).toMatchObject({
      artifact: {
        id: artifact.id,
        kind: artifact.kind,
        path: artifact.path,
      },
      content: '# Deck\n\n<Slide />',
    });
    expect(service.current('session-1')).toEqual(artifact);
  });

  it('lists artifacts by session, domain, and kind with newest first', () => {
    const artifactRoot = mkdtempSync(join(tmpdir(), 'heddle-artifacts-'));
    let id = 0;
    const service = new ArtifactService({
      artifactRoot,
      now: () => `2026-07-01T00:00:0${id}.000Z`,
      nextId: () => `artifact-${++id}`,
    });

    const first = service.saveText({
      kind: 'source',
      domain: 'presentation',
      content: 'source',
      sessionId: 'session-1',
    });
    const second = service.saveText({
      kind: 'html',
      domain: 'presentation',
      content: '<html></html>',
      sessionId: 'session-1',
    });
    service.saveText({
      kind: 'source',
      domain: 'report',
      content: 'report',
      sessionId: 'session-2',
    });

    expect(service.list({ sessionId: 'session-1' }).map((artifact) => artifact.id)).toEqual([second.id, first.id]);
    expect(service.list({ domain: 'presentation', kind: 'source' }).map((artifact) => artifact.id)).toEqual([first.id]);
  });

  it('supports workspace and session current artifact pointers', () => {
    const artifactRoot = mkdtempSync(join(tmpdir(), 'heddle-artifacts-'));
    let id = 0;
    const service = new ArtifactService({
      artifactRoot,
      now: () => '2026-07-01T00:00:00.000Z',
      nextId: () => `artifact-${++id}`,
    });

    const workspaceArtifact = service.saveText({
      kind: 'html',
      content: '<html></html>',
    });
    const sessionArtifact = service.saveText({
      kind: 'source',
      content: 'source',
      sessionId: 'session-1',
    });

    expect(service.current()).toEqual(workspaceArtifact);
    expect(service.current('session-1')).toEqual(sessionArtifact);
    expect(service.current('session-2')).toEqual(workspaceArtifact);

    service.setCurrent(sessionArtifact.id);
    expect(service.current()).toEqual(sessionArtifact);
  });

  it('returns an empty store for malformed indexes without deleting artifact files', () => {
    const artifactRoot = mkdtempSync(join(tmpdir(), 'heddle-artifacts-'));
    const repository = new FileArtifactRepository({ artifactRoot });
    const service = new ArtifactService({
      artifactRoot,
      now: () => '2026-07-01T00:00:00.000Z',
      nextId: () => 'artifact-1',
    });
    const artifact = service.saveText({
      kind: 'source',
      content: 'content',
    });

    expect(existsSync(artifact.path)).toBe(true);
    expect(repository.readCatalog().artifacts).toHaveLength(1);

    const storePath = FileArtifactRepository.resolveStorePath(artifactRoot);
    // Keep malformed JSON from surfacing partial or invalid artifact state.
    writeFileSync(storePath, '{not valid json', 'utf8');

    expect(repository.readCatalog()).toEqual(FileArtifactRepository.emptyStore());
    expect(existsSync(artifact.path)).toBe(true);
  });

  it('runs the full artifact lifecycle through a custom repository with no filesystem access', () => {
    const repository = createInMemoryArtifactRepository();
    let id = 0;
    const service = new ArtifactService({
      repository,
      now: () => `2026-07-02T00:00:0${id}.000Z`,
      nextId: () => `artifact-${++id}`,
    });

    const source = service.saveText({
      kind: 'source',
      content: '# Deck',
      sessionId: 'session-1',
    });
    const html = service.saveText({
      kind: 'html',
      content: '<html></html>',
      sessionId: 'session-1',
    });

    expect(source.path).toBe('memory://artifact-1.txt');
    expect(repository.contents.get('memory://artifact-1.txt')).toBe('# Deck');
    expect(service.list({ sessionId: 'session-1' }).map((artifact) => artifact.id)).toEqual([html.id, source.id]);
    expect(service.read(source.id)).toEqual({ artifact: source, content: '# Deck' });
    expect(service.current('session-1')).toEqual(html);

    service.setCurrent(source.id, { sessionId: 'session-1' });
    expect(service.current('session-1')).toEqual(source);
  });

  it('requires either a repository or an artifactRoot', () => {
    expect(() => new ArtifactService({})).toThrow('ArtifactService requires either a repository or an artifactRoot.');
  });

  it('rejects duplicate artifact ids instead of overwriting stored files', () => {
    const artifactRoot = mkdtempSync(join(tmpdir(), 'heddle-artifacts-'));
    const service = new ArtifactService({
      artifactRoot,
      now: () => '2026-07-01T00:00:00.000Z',
      nextId: () => 'same-id',
    });

    service.saveText({
      kind: 'source',
      content: 'original',
    });

    expect(() => service.saveText({
      kind: 'source',
      content: 'replacement',
    })).toThrow('Artifact already exists: same-id');
    expect(readFileSync(join(artifactRoot, 'files', 'same-id.txt'), 'utf8')).toBe('original');
  });
});
