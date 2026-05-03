import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import type { ToolResult } from '../../../types.js';

export type ReplaceEditInput = {
  path: string;
  oldText: string;
  newText: string;
  replaceAll?: boolean;
};

export type WriteEditInput = {
  path: string;
  content: string;
  createIfMissing?: boolean;
};

export type ScopedEditInput = ReplaceEditInput | WriteEditInput;

export type EditPreview = {
  path: string;
  action: 'created' | 'overwritten' | 'replaced';
  diff: string;
  truncated: boolean;
};

type ScopedEditOptions = {
  toolName: string;
  rootPath: string;
  rootLabel: string;
  subjectLabel: string;
  creationHint: string;
  enforceRoot?: boolean;
};

const DIFF_CONTEXT_LINES = 2;
const MAX_DIFF_PREVIEW_LINES = 80;

export function isScopedEditInput(raw: unknown): raw is ScopedEditInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return false;
  }

  const input = raw as Record<string, unknown>;
  const keys = Object.keys(input);
  const allowedKeys = new Set(['path', 'oldText', 'newText', 'replaceAll', 'content', 'createIfMissing']);
  if (keys.some((key) => !allowedKeys.has(key))) {
    return false;
  }

  if (typeof input.path !== 'string' || !input.path.trim()) {
    return false;
  }

  const hasReplaceShape = typeof input.oldText === 'string' && typeof input.newText === 'string';
  const hasWriteShape = typeof input.content === 'string';

  if (hasReplaceShape === hasWriteShape) {
    return false;
  }

  if (hasReplaceShape) {
    return input.replaceAll === undefined || typeof input.replaceAll === 'boolean';
  }

  return input.createIfMissing === undefined || typeof input.createIfMissing === 'boolean';
}

export async function executeScopedEdit(raw: unknown, options: ScopedEditOptions): Promise<ToolResult> {
  if (!isScopedEditInput(raw)) {
    return {
      ok: false,
      error:
        `Invalid input for ${options.toolName}. Use either { "path", "oldText", "newText", "replaceAll?" } or { "path", "content", "createIfMissing?" }.`,
    };
  }

  const targetPath = resolve(options.rootPath, raw.path);
  if (options.enforceRoot && isOutsideRoot(options.rootPath, targetPath)) {
    return {
      ok: false,
      error: `${options.subjectLabel} paths must stay inside ${options.rootLabel}: ${options.rootPath}. Refusing to access ${targetPath}.`,
    };
  }

  if ('content' in raw) {
    return writeScopedContent(raw, targetPath, options);
  }

  return replaceScopedContent(raw, targetPath, options);
}

export async function previewScopedEdit(raw: unknown, options: Omit<ScopedEditOptions, 'creationHint'>): Promise<EditPreview | undefined> {
  if (!isScopedEditInput(raw)) {
    return undefined;
  }

  const targetPath = resolve(options.rootPath, raw.path);
  const scopedPath = toScopedPath(options.rootPath, targetPath);

  if ('content' in raw) {
    const existed = await pathExists(targetPath);
    if (!existed && !raw.createIfMissing) {
      return undefined;
    }

    let previousContent = '';
    if (existed) {
      try {
        previousContent = await readFile(targetPath, 'utf8');
      } catch {
        return undefined;
      }
    }
    return buildDiffPreview(previousContent, raw.content, scopedPath, existed ? 'overwritten' : 'created');
  }

  let current: string;
  try {
    current = await readFile(targetPath, 'utf8');
  } catch {
    return undefined;
  }

  const matchCount = countOccurrences(current, raw.oldText);
  if (matchCount === 0 || (matchCount > 1 && !raw.replaceAll)) {
    return undefined;
  }

  const nextContent =
    raw.replaceAll ? current.split(raw.oldText).join(raw.newText) : replaceFirst(current, raw.oldText, raw.newText);

  return buildDiffPreview(current, nextContent, scopedPath, 'replaced');
}

async function writeScopedContent(input: WriteEditInput, targetPath: string, options: ScopedEditOptions): Promise<ToolResult> {
  const existed = await pathExists(targetPath);
  let previousContent = '';
  if (existed) {
    try {
      previousContent = await readFile(targetPath, 'utf8');
    } catch (error) {
      return {
        ok: false,
        error: `Failed to read ${targetPath}: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  if (!existed && !input.createIfMissing) {
    return {
      ok: false,
      error: `${options.subjectLabel} does not exist: ${targetPath}. ${options.creationHint}`,
    };
  }

  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, input.content, 'utf8');

  return {
    ok: true,
    output: {
      path: toScopedPath(options.rootPath, targetPath),
      action: existed ? 'overwritten' : 'created',
      bytesWritten: Buffer.byteLength(input.content, 'utf8'),
      diff: buildDiffPreview(previousContent, input.content, toScopedPath(options.rootPath, targetPath), existed ? 'overwritten' : 'created'),
    },
  };
}

async function replaceScopedContent(input: ReplaceEditInput, targetPath: string, options: ScopedEditOptions): Promise<ToolResult> {
  let current: string;
  try {
    current = await readFile(targetPath, 'utf8');
  } catch (error) {
    return {
      ok: false,
      error: `Failed to read ${targetPath}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const matchCount = countOccurrences(current, input.oldText);
  if (matchCount === 0) {
    return {
      ok: false,
      error: `${options.toolName} could not find the requested oldText in ${targetPath}. Read the ${options.subjectLabel} again and provide an exact match.`,
    };
  }

  if (matchCount > 1 && !input.replaceAll) {
    return {
      ok: false,
      error: `${options.toolName} found ${matchCount} matches for oldText in ${targetPath}. Refine oldText or set replaceAll to true.`,
    };
  }

  const nextContent =
    input.replaceAll ? current.split(input.oldText).join(input.newText) : replaceFirst(current, input.oldText, input.newText);

  await writeFile(targetPath, nextContent, 'utf8');

  return {
    ok: true,
    output: {
      path: toScopedPath(options.rootPath, targetPath),
      action: 'replaced',
      matchCount,
      bytesWritten: Buffer.byteLength(nextContent, 'utf8'),
      diff: buildDiffPreview(current, nextContent, toScopedPath(options.rootPath, targetPath), 'replaced'),
    },
  };
}

function countOccurrences(content: string, search: string): number {
  if (!search) {
    return 0;
  }

  let count = 0;
  let index = 0;
  while (true) {
    const nextIndex = content.indexOf(search, index);
    if (nextIndex === -1) {
      return count;
    }
    count++;
    index = nextIndex + search.length;
  }
}

function replaceFirst(content: string, search: string, replacement: string): string {
  const index = content.indexOf(search);
  if (index === -1) {
    return content;
  }

  return `${content.slice(0, index)}${replacement}${content.slice(index + search.length)}`;
}

function toScopedPath(rootPath: string, targetPath: string): string {
  const rel = relative(rootPath, targetPath);
  if (rel === '') {
    return '.';
  }

  if (rel.startsWith('..') || isAbsolute(rel)) {
    return targetPath;
  }

  return rel;
}

function isOutsideRoot(rootPath: string, targetPath: string): boolean {
  const rel = relative(rootPath, targetPath);
  return rel.startsWith('..') || isAbsolute(rel);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function buildDiffPreview(
  previousContent: string,
  nextContent: string,
  path: string,
  action: EditPreview['action'],
): EditPreview {
  const previousLines = splitLines(previousContent);
  const nextLines = splitLines(nextContent);
  const prefix = countCommonPrefix(previousLines, nextLines);
  const suffix = countCommonSuffix(previousLines, nextLines, prefix);
  const previousChangedEnd = previousLines.length - suffix;
  const nextChangedEnd = nextLines.length - suffix;
  const contextStart = Math.max(0, prefix - DIFF_CONTEXT_LINES);
  const previousContextEnd = Math.min(previousLines.length, previousChangedEnd + DIFF_CONTEXT_LINES);
  const nextContextEnd = Math.min(nextLines.length, nextChangedEnd + DIFF_CONTEXT_LINES);

  const lines = [
    `--- ${action === 'created' ? '/dev/null' : `a/${path}`}`,
    `+++ b/${path}`,
    `@@ -${formatHunkRange(contextStart + 1, previousContextEnd - contextStart)} +${formatHunkRange(contextStart + 1, nextContextEnd - contextStart)} @@`,
    ...previousLines.slice(contextStart, prefix).map((line) => ` ${line}`),
    ...previousLines.slice(prefix, previousChangedEnd).map((line) => `-${line}`),
    ...nextLines.slice(prefix, nextChangedEnd).map((line) => `+${line}`),
    ...nextLines.slice(nextChangedEnd, nextContextEnd).map((line) => ` ${line}`),
  ];

  if (lines.length <= MAX_DIFF_PREVIEW_LINES) {
    return { path, action, diff: lines.join('\n'), truncated: false };
  }

  const truncatedLines = [
    ...lines.slice(0, MAX_DIFF_PREVIEW_LINES - 1),
    '... diff preview truncated ...',
  ];
  return { path, action, diff: truncatedLines.join('\n'), truncated: true };
}

function splitLines(content: string): string[] {
  if (!content) {
    return [];
  }

  return content.replace(/\r\n/g, '\n').split('\n').slice(0, content.endsWith('\n') ? -1 : undefined);
}

function countCommonPrefix(previousLines: string[], nextLines: string[]): number {
  let index = 0;
  while (index < previousLines.length && index < nextLines.length && previousLines[index] === nextLines[index]) {
    index++;
  }
  return index;
}

function countCommonSuffix(previousLines: string[], nextLines: string[], prefix: number): number {
  let count = 0;
  while (
    previousLines.length - count - 1 >= prefix &&
    nextLines.length - count - 1 >= prefix &&
    previousLines[previousLines.length - count - 1] === nextLines[nextLines.length - count - 1]
  ) {
    count++;
  }
  return count;
}

function formatHunkRange(startLine: number, length: number): string {
  if (length === 0) {
    return `${startLine},0`;
  }

  return length <= 1 ? `${startLine}` : `${startLine},${length}`;
}
