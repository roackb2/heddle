import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ArtifactService } from '@/core/artifacts/index.js';
import { artifactsToolkit } from '@/core/tools/toolkits/artifacts/index.js';
import type { ToolDefinition } from '@/core/types.js';
import type { ToolToolkitContext } from '@/core/tools/index.js';

describe('artifact toolkit', () => {
  it('saves, lists, reads, and selects session artifacts', async () => {
    const root = mkdtempSync(join(tmpdir(), 'heddle-artifact-toolkit-'));
    const artifactRoot = join(root, '.heddle', 'artifacts');
    const tools = toolMap(artifactsToolkit.createTools(toolContext(root, artifactRoot, 'session-1')));

    const saved = await tools.save_artifact.execute({
      kind: 'source',
      domain: 'presentation',
      title: 'deck.motion.md',
      content: '# Deck',
      metadata: { slideCount: 1 },
    });

    expect(saved.ok).toBe(true);
    const artifactId = ((saved.output as Record<string, unknown>).artifact as Record<string, unknown>).id as string;
    expect(new ArtifactService({ artifactRoot }).current('session-1')?.id).toBe(artifactId);

    const otherSessionArtifact = new ArtifactService({ artifactRoot }).saveText({
      kind: 'document',
      title: 'other-session.md',
      content: '# Other Session',
      sessionId: 'session-2',
    });

    const dashboard = await tools.artifact_dashboard.execute({});
    const recentArtifactIds = ((dashboard.output as Record<string, unknown>).recent as Array<Record<string, unknown>>)
      .map((artifact) => artifact.id);
    expect(dashboard.output).toMatchObject({
      current: {
        id: artifactId,
        relativePath: `files/${artifactId}.md`,
      },
    });
    expect(recentArtifactIds).toContain(artifactId);
    expect(recentArtifactIds).not.toContain(otherSessionArtifact.id);

    const listed = await tools.list_artifacts.execute({ scope: 'current-session', domain: 'presentation' });
    expect(((listed.output as Record<string, unknown>).artifacts as Array<Record<string, unknown>>)[0]).toMatchObject({
      id: artifactId,
      domain: 'presentation',
    });

    const read = await tools.read_artifact.execute({});
    expect(read.output).toMatchObject({
      artifact: { id: artifactId },
      content: '# Deck',
    });

    const second = await tools.save_artifact.execute({
      kind: 'html',
      title: 'deck.html',
      content: '<html></html>',
      setCurrent: false,
    });
    const secondId = ((second.output as Record<string, unknown>).artifact as Record<string, unknown>).id as string;

    await tools.set_current_artifact.execute({ id: secondId });
    expect(new ArtifactService({ artifactRoot }).current('session-1')?.id).toBe(secondId);
  });

  it('persists through a context-injected artifact repository instead of the artifact root', async () => {
    const root = mkdtempSync(join(tmpdir(), 'heddle-artifact-toolkit-injected-'));
    const artifactRoot = join(root, '.heddle', 'artifacts');
    let catalog = { version: 1 as const, artifacts: [], current: { sessionArtifactIds: {} } };
    const contents = new Map<string, string>();
    const tools = toolMap(artifactsToolkit.createTools({
      ...toolContext(root, artifactRoot, 'session-1'),
      artifactRepository: {
        readCatalog: () => structuredClone(catalog),
        writeCatalog: (store) => {
          catalog = structuredClone(store) as typeof catalog;
        },
        contentKey: (id, extension) => `hosted://${id}.${extension}`,
        contentExists: (key) => contents.has(key),
        writeContent: (key, content) => {
          contents.set(key, content);
        },
        readContent: (key) => contents.get(key),
      },
    }));

    const saved = await tools.save_artifact.execute({
      kind: 'source',
      content: '# Hosted deck',
    });
    expect(saved.ok).toBe(true);
    const artifactId = ((saved.output as Record<string, unknown>).artifact as Record<string, unknown>).id as string;

    const read = await tools.read_artifact.execute({ id: artifactId });
    expect(read.output).toMatchObject({ content: '# Hosted deck' });
    expect(contents.get(`hosted://${artifactId}.txt`)).toBe('# Hosted deck');
    // The on-disk artifact root stayed untouched.
    expect(existsSync(artifactRoot)).toBe(false);
  });

  it('returns a tool error when reading without a current artifact', async () => {
    const root = mkdtempSync(join(tmpdir(), 'heddle-artifact-toolkit-empty-'));
    const tools = toolMap(artifactsToolkit.createTools(toolContext(root, join(root, '.heddle', 'artifacts'), 'session-1')));

    await expect(tools.read_artifact.execute({})).resolves.toMatchObject({
      ok: false,
      error: 'No artifact id was provided and no current artifact is set for this session.',
    });
    await expect(tools.set_current_artifact.execute({ id: 'missing' })).resolves.toMatchObject({
      ok: false,
      error: 'Artifact not found: missing',
    });
  });
});

function toolContext(root: string, artifactRoot: string, sessionId: string): ToolToolkitContext {
  return {
    workspaceRoot: root,
    stateRoot: join(root, '.heddle'),
    artifactRoot,
    sessionId,
    model: 'gpt-5.4',
    memoryDir: join(root, '.heddle', 'memory'),
    memoryMode: 'none',
  };
}

function toolMap(tools: ToolDefinition[]): Record<string, ToolDefinition> {
  return Object.fromEntries(tools.map((tool) => [tool.name, tool]));
}
