import { readFile, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import {
  DEFAULT_MEMORY_FOLDER_CATALOG_MAX_BYTES,
  DEFAULT_MEMORY_ROOT_CATALOG_MAX_BYTES,
  bootstrapMemoryWorkspace,
  validateMemoryCatalogShape,
} from './catalog.js';
import { readPendingKnowledgeCandidates } from './maintainer.js';
import { listMemoryNotePaths } from './visibility.js';

export type MemoryValidationIssue =
  | {
    type: 'missing_catalog';
    severity: 'error';
    path: string;
    message: string;
  }
  | {
    type: 'oversized_catalog';
    severity: 'warning';
    path: string;
    sizeBytes: number;
    maxBytes: number;
    message: string;
  }
  | {
    type: 'orphan_note';
    severity: 'warning';
    path: string;
    message: string;
  }
  | {
    type: 'pending_candidates';
    severity: 'info';
    count: number;
    message: string;
  };

export type MemoryValidationResult = {
  memoryRoot: string;
  ok: boolean;
  issueCount: number;
  issues: MemoryValidationIssue[];
};

export async function validateMemoryWorkspace(options: { memoryRoot: string }): Promise<MemoryValidationResult> {
  const memoryRoot = resolve(options.memoryRoot);
  const issues: MemoryValidationIssue[] = [];
  const shape = validateMemoryCatalogShape({ memoryRoot });
  for (const path of shape.missing) {
    issues.push({
      type: 'missing_catalog',
      severity: 'error',
      path,
      message: `Missing required memory catalog: ${path}`,
    });
  }

  const notes = await listMemoryNotePaths({ memoryRoot });
  await appendOversizedCatalogIssues(memoryRoot, notes, issues);
  await appendOrphanNoteIssues(memoryRoot, notes, issues);

  const pending = await readPendingKnowledgeCandidates({ memoryRoot });
  if (pending.length > 0) {
    issues.push({
      type: 'pending_candidates',
      severity: 'info',
      count: pending.length,
      message: `${pending.length} pending memory candidate${pending.length === 1 ? '' : 's'} waiting for maintenance.`,
    });
  }

  return {
    memoryRoot,
    ok: issues.every((issue) => issue.severity !== 'error'),
    issueCount: issues.length,
    issues,
  };
}

export async function repairMissingMemoryCatalogs(options: { memoryRoot: string }): Promise<{ memoryRoot: string; createdPaths: string[] }> {
  return bootstrapMemoryWorkspace({ memoryRoot: options.memoryRoot });
}

async function appendOversizedCatalogIssues(memoryRoot: string, notes: string[], issues: MemoryValidationIssue[]) {
  for (const path of notes.filter((note) => basename(note).toLowerCase() === 'readme.md')) {
    const fullPath = join(memoryRoot, path);
    const info = await stat(fullPath);
    const maxBytes = path === 'README.md' ? DEFAULT_MEMORY_ROOT_CATALOG_MAX_BYTES : DEFAULT_MEMORY_FOLDER_CATALOG_MAX_BYTES;
    if (info.size <= maxBytes) {
      continue;
    }

    issues.push({
      type: 'oversized_catalog',
      severity: 'warning',
      path,
      sizeBytes: info.size,
      maxBytes,
      message: `Memory catalog ${path} is ${info.size} bytes, above the ${maxBytes} byte cap.`,
    });
  }
}

async function appendOrphanNoteIssues(memoryRoot: string, notes: string[], issues: MemoryValidationIssue[]) {
  const catalogPaths = notes.filter((note) => basename(note).toLowerCase() === 'readme.md');
  const catalogTextByPath = new Map<string, string>();
  for (const catalogPath of catalogPaths) {
    catalogTextByPath.set(catalogPath, await readFile(join(memoryRoot, catalogPath), 'utf8'));
  }

  for (const note of notes) {
    if (basename(note).toLowerCase() === 'readme.md') {
      continue;
    }

    const folderCatalog = catalogPathForNote(note);
    const folderCatalogText = catalogTextByPath.get(folderCatalog) ?? '';
    const rootCatalogText = catalogTextByPath.get('README.md') ?? '';
    const localName = basename(note);
    const linkedFromFolder = folderCatalogText.includes(localName) || folderCatalogText.includes(note);
    const linkedFromRoot = rootCatalogText.includes(note);
    if (linkedFromFolder || linkedFromRoot) {
      continue;
    }

    issues.push({
      type: 'orphan_note',
      severity: 'warning',
      path: note,
      message: orphanNoteMessage(note, folderCatalog),
    });
  }
}

function catalogPathForNote(path: string): string {
  const folder = dirname(path);
  return folder === '.' ? 'README.md' : join(folder, 'README.md');
}

function orphanNoteMessage(note: string, folderCatalog: string): string {
  return folderCatalog === 'README.md' ?
    `Memory note ${note} is not linked from README.md.`
  : `Memory note ${note} is not linked from ${folderCatalog} or README.md.`;
}
