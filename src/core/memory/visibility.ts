import { access, readdir, readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { createReadMemoryNoteTool, createSearchMemoryNotesTool } from '../tools/memory-notes.js';
import { validateMemoryCatalogShape } from './catalog.js';
import { readPendingKnowledgeCandidates, type KnowledgeMaintenanceRunRecord } from './maintainer.js';

export type MemoryStatusView = {
  memoryRoot: string;
  catalog: {
    ok: boolean;
    missing: string[];
  };
  notes: {
    count: number;
  };
  candidates: {
    pending: number;
  };
  runs: {
    latest: KnowledgeMaintenanceRunRecord[];
  };
};

export async function loadMemoryStatus(options: {
  memoryRoot: string;
  recentRunLimit?: number;
}): Promise<MemoryStatusView> {
  const memoryRoot = resolve(options.memoryRoot);
  const [notes, pending, latestRuns] = await Promise.all([
    listMemoryNotePaths({ memoryRoot }),
    readPendingKnowledgeCandidates({ memoryRoot }),
    readRecentMemoryMaintenanceRuns({ memoryRoot, limit: options.recentRunLimit ?? 5 }),
  ]);
  const catalog = validateMemoryCatalogShape({ memoryRoot });

  return {
    memoryRoot,
    catalog: {
      ok: catalog.ok,
      missing: catalog.missing,
    },
    notes: {
      count: notes.length,
    },
    candidates: {
      pending: pending.length,
    },
    runs: {
      latest: latestRuns,
    },
  };
}

export async function listMemoryNotePaths(options: { memoryRoot: string; path?: string }): Promise<string[]> {
  const memoryRoot = resolve(options.memoryRoot);
  const target = resolveMemoryPath(memoryRoot, options.path ?? '.');
  if (!target.ok) {
    throw new Error(target.error);
  }

  if (!await pathExists(target.path)) {
    return [];
  }

  const notes = await listMarkdownNotes(target.path);
  return notes.map((path) => toMemoryRelativePath(memoryRoot, path)).sort();
}

export async function readMemoryNote(options: {
  memoryRoot: string;
  path: string;
  offset?: number;
  maxLines?: number;
}): Promise<string> {
  const result = await createReadMemoryNoteTool({ memoryRoot: options.memoryRoot }).execute({
    path: options.path,
    offset: options.offset,
    maxLines: options.maxLines,
  });
  if (!result.ok) {
    throw new Error(result.error);
  }
  return typeof result.output === 'string' ? result.output : JSON.stringify(result.output, null, 2);
}

export async function searchMemoryNotes(options: {
  memoryRoot: string;
  query: string;
  path?: string;
  maxResults?: number;
}): Promise<string> {
  const result = await createSearchMemoryNotesTool({ memoryRoot: options.memoryRoot }).execute({
    query: options.query,
    path: options.path,
    maxResults: options.maxResults,
  });
  if (!result.ok) {
    throw new Error(result.error);
  }
  return typeof result.output === 'string' ? result.output : JSON.stringify(result.output, null, 2);
}

export async function readRecentMemoryMaintenanceRuns(options: {
  memoryRoot: string;
  limit?: number;
}): Promise<KnowledgeMaintenanceRunRecord[]> {
  const memoryRoot = resolve(options.memoryRoot);
  const raw = await readTextIfExists(resolve(memoryRoot, '_maintenance', 'runs.jsonl'));
  if (!raw) {
    return [];
  }

  return raw
    .split(/\r?\n/u)
    .filter((line) => line.trim())
    .map(parseRunRecord)
    .filter((run): run is KnowledgeMaintenanceRunRecord => Boolean(run))
    .slice(-(options.limit ?? 5))
    .reverse();
}

function resolveMemoryPath(memoryRoot: string, requestedPath: string): { ok: true; path: string } | { ok: false; error: string } {
  if (!requestedPath.trim()) {
    return { ok: false, error: `Memory note paths must be non-empty and stay inside ${memoryRoot}.` };
  }

  const targetPath = resolve(memoryRoot, requestedPath);
  const rel = relative(memoryRoot, targetPath);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    return { ok: false, error: `Memory note paths must stay inside ${memoryRoot}. Refusing to access ${targetPath}.` };
  }

  return { ok: true, path: targetPath };
}

async function listMarkdownNotes(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    if (entry.name === '_maintenance') {
      continue;
    }

    const nextPath = resolve(root, entry.name);
    if (entry.isDirectory()) {
      results.push(...await listMarkdownNotes(nextPath));
      continue;
    }

    if (entry.isFile() && /\.md$/iu.test(entry.name)) {
      results.push(nextPath);
    }
  }
  return results;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readTextIfExists(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

function parseRunRecord(line: string): KnowledgeMaintenanceRunRecord | undefined {
  try {
    const parsed = JSON.parse(line) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return undefined;
    }
    const record = parsed as Record<string, unknown>;
    return typeof record.id === 'string'
      && typeof record.startedAt === 'string'
      && typeof record.finishedAt === 'string'
      && typeof record.source === 'string'
      && typeof record.outcome === 'string'
      && typeof record.summary === 'string'
      && Array.isArray(record.candidateIds)
      && Array.isArray(record.processedCandidateIds)
      && Array.isArray(record.failedCandidateIds)
      && typeof record.catalogValid === 'boolean'
      && Array.isArray(record.catalogMissing) ?
        record as KnowledgeMaintenanceRunRecord
    : undefined;
  } catch {
    return undefined;
  }
}

function toMemoryRelativePath(memoryRoot: string, filePath: string): string {
  return relative(memoryRoot, filePath) || '.';
}
