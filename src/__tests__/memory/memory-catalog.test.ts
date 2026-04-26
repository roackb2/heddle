import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  appendMemoryCatalogSystemContext,
  bootstrapMemoryWorkspace,
  DEFAULT_MEMORY_CATEGORIES,
  loadMemoryRootCatalog,
  validateMemoryCatalogShape,
} from '../../core/memory/catalog.js';

describe('memory catalog', () => {
  it('bootstraps a cataloged memory workspace without overwriting existing notes', () => {
    const memoryRoot = mkdtempSync(join(tmpdir(), 'heddle-memory-catalog-'));
    writeFileSync(join(memoryRoot, 'README.md'), '# Existing Memory\n', 'utf8');

    const result = bootstrapMemoryWorkspace({ memoryRoot });

    expect(readFileSync(join(memoryRoot, 'README.md'), 'utf8')).toBe('# Existing Memory\n');
    expect(result.createdPaths).toEqual(expect.arrayContaining([
      'current-state/README.md',
      'workflows/README.md',
      'preferences/README.md',
      'domain/README.md',
      'operations/README.md',
      'relationships/README.md',
      'history/README.md',
      '_maintenance/runs.jsonl',
    ]));
    for (const category of DEFAULT_MEMORY_CATEGORIES) {
      expect(existsSync(join(memoryRoot, category.path, 'README.md'))).toBe(true);
    }
    expect(validateMemoryCatalogShape({ memoryRoot })).toEqual({
      ok: true,
      memoryRoot,
      missing: [],
    });
  });

  it('returns bounded missing-catalog guidance when no root catalog exists', () => {
    const memoryRoot = mkdtempSync(join(tmpdir(), 'heddle-memory-missing-'));

    const result = loadMemoryRootCatalog({ memoryRoot, maxBytes: 200 });

    expect(result.exists).toBe(false);
    expect(result.truncated).toBe(false);
    expect(result.content).toContain('No workspace memory catalog exists yet.');
    expect(result.content).toContain(join(memoryRoot, 'README.md'));
  });

  it('truncates oversized root catalogs deterministically', () => {
    const memoryRoot = mkdtempSync(join(tmpdir(), 'heddle-memory-truncate-'));
    writeFileSync(join(memoryRoot, 'README.md'), `# Memory\n\n${'A'.repeat(200)}`, 'utf8');

    const result = loadMemoryRootCatalog({ memoryRoot, maxBytes: 32 });

    expect(result.exists).toBe(true);
    expect(result.truncated).toBe(true);
    expect(result.content).toContain('[Memory catalog truncated to 32 bytes');
    expect(result.content).toContain('Use read_memory_note on README.md');
  });

  it('appends the memory domain model and root catalog to existing system context only', () => {
    const memoryRoot = mkdtempSync(join(tmpdir(), 'heddle-memory-context-'));
    bootstrapMemoryWorkspace({ memoryRoot });

    const context = appendMemoryCatalogSystemContext({
      systemContext: 'Source: AGENTS.md\nRead docs first.',
      memoryRoot,
    });

    expect(context).toContain('Source: AGENTS.md');
    expect(context).toContain('## Heddle-Managed Memory Domain');
    expect(context).toContain('Heddle-managed memory is the durable recall substrate for the agent.');
    expect(context).toContain('Repository docs such as README files, AGENTS.md, or docs/ are project-authored evidence.');
    expect(context).toContain('For preference-shaped, workflow-shaped, planning-style, ticket/format');
    expect(context).toContain('Follow the catalog path: read the root memory catalog, then the relevant folder README catalog, then focused notes listed there.');
    expect(context).toContain('Every durable memory note must be discoverable from the root README.md or a folder README.md.');
    expect(context).toContain('## Workspace Memory Catalog');
    expect(context).toContain(`Source: ${join(memoryRoot, 'README.md')}`);
    expect(context).toContain('Startup memory policy: this is the only memory document loaded automatically.');
    expect(context).not.toContain('# Current State');
  });

  it('reports missing folder catalogs', () => {
    const memoryRoot = mkdtempSync(join(tmpdir(), 'heddle-memory-invalid-'));
    writeFileSync(join(memoryRoot, 'README.md'), '# Memory\n', 'utf8');

    const result = validateMemoryCatalogShape({ memoryRoot });

    expect(result.ok).toBe(false);
    expect(result.missing).toContain('current-state/README.md');
  });
});
