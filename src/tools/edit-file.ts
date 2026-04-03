// ---------------------------------------------------------------------------
// Tool: edit_file
// ---------------------------------------------------------------------------

import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import type { ToolDefinition, ToolResult } from '../types.js';

type ReplaceEditInput = {
  path: string;
  oldText: string;
  newText: string;
  replaceAll?: boolean;
};

type WriteEditInput = {
  path: string;
  content: string;
  createIfMissing?: boolean;
};

type EditFileInput = ReplaceEditInput | WriteEditInput;

export type EditFilePreview = {
  path: string;
  action: 'created' | 'overwritten' | 'replaced';
  diff: string;
  truncated: boolean;
};

const DIFF_CONTEXT_LINES = 2;
const MAX_DIFF_PREVIEW_LINES = 80;

export const editFileTool: ToolDefinition = {
  name: 'edit_file',
  description:
    'Edit a file directly inside the current workspace without going through shell redirection or heredocs. Prefer this over shell commands when you need to create or change file contents. Use { "path", "oldText", "newText" } for an exact replacement, optionally with replaceAll, or use { "path", "content", "createIfMissing" } to overwrite an existing file or create a new one explicitly. This tool only writes inside the current workspace root and returns a structured edit summary.',
  requiresApproval: true,
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      path: {
        type: 'string',
        description: 'Workspace-relative path to the file to edit',
      },
      oldText: {
        type: 'string',
        description: 'Existing text to replace exactly',
      },
      newText: {
        type: 'string',
        description: 'Replacement text for oldText',
      },
      replaceAll: {
        type: 'boolean',
        description: 'Replace every matching occurrence instead of requiring a single exact match',
      },
      content: {
        type: 'string',
        description: 'Full file content to write',
      },
      createIfMissing: {
        type: 'boolean',
        description: 'Allow creating the file if it does not already exist when using content',
      },
    },
    required: ['path'],
  },
  async execute(raw: unknown): Promise<ToolResult> {
    if (!isEditFileInput(raw)) {
      return {
        ok: false,
        error:
          'Invalid input for edit_file. Use either { "path", "oldText", "newText", "replaceAll?" } or { "path", "content", "createIfMissing?" }.',
      };
    }

    const workspaceRoot = process.cwd();
    const targetPath = resolve(raw.path);

    if (!isInsideWorkspace(workspaceRoot, targetPath)) {
      return {
        ok: false,
        error: `edit_file only writes inside the current workspace root (${workspaceRoot}). Refusing to modify ${targetPath}.`,
      };
    }

    if ('content' in raw) {
      return writeFileContent(raw, workspaceRoot, targetPath);
    }

    return replaceFileContent(raw, workspaceRoot, targetPath);
  },
};

async function writeFileContent(input: WriteEditInput, workspaceRoot: string, targetPath: string): Promise<ToolResult> {
  const existed = await pathExists(targetPath);
  const previousContent = existed ? await readFile(targetPath, 'utf8') : '';

  if (!existed && !input.createIfMissing) {
    return {
      ok: false,
      error: `File does not exist: ${targetPath}. Set createIfMissing to true if you want edit_file to create it.`,
    };
  }

  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, input.content, 'utf8');

  return {
    ok: true,
    output: {
      path: toWorkspacePath(workspaceRoot, targetPath),
      action: existed ? 'overwritten' : 'created',
      bytesWritten: Buffer.byteLength(input.content, 'utf8'),
      diff: buildDiffPreview(previousContent, input.content, toWorkspacePath(workspaceRoot, targetPath), existed ? 'overwritten' : 'created'),
    },
  };
}

async function replaceFileContent(input: ReplaceEditInput, workspaceRoot: string, targetPath: string): Promise<ToolResult> {
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
      error: `edit_file could not find the requested oldText in ${targetPath}. Read the file again and provide an exact match.`,
    };
  }

  if (matchCount > 1 && !input.replaceAll) {
    return {
      ok: false,
      error: `edit_file found ${matchCount} matches for oldText in ${targetPath}. Refine oldText or set replaceAll to true.`,
    };
  }

  const nextContent =
    input.replaceAll ? current.split(input.oldText).join(input.newText) : replaceFirst(current, input.oldText, input.newText);

  await writeFile(targetPath, nextContent, 'utf8');

  return {
    ok: true,
    output: {
      path: toWorkspacePath(workspaceRoot, targetPath),
      action: 'replaced',
      matchCount,
      bytesWritten: Buffer.byteLength(nextContent, 'utf8'),
      diff: buildDiffPreview(current, nextContent, toWorkspacePath(workspaceRoot, targetPath), 'replaced'),
    },
  };
}

export async function previewEditFileInput(raw: unknown, workspaceRoot: string = process.cwd()): Promise<EditFilePreview | undefined> {
  if (!isEditFileInput(raw)) {
    return undefined;
  }

  const targetPath = resolve(raw.path);
  if (!isInsideWorkspace(workspaceRoot, targetPath)) {
    return undefined;
  }

  const workspacePath = toWorkspacePath(workspaceRoot, targetPath);

  if ('content' in raw) {
    const existed = await pathExists(targetPath);
    if (!existed && !raw.createIfMissing) {
      return undefined;
    }

    const previousContent = existed ? await readFile(targetPath, 'utf8') : '';
    return buildDiffPreview(previousContent, raw.content, workspacePath, existed ? 'overwritten' : 'created');
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

  return buildDiffPreview(current, nextContent, workspacePath, 'replaced');
}

function isEditFileInput(raw: unknown): raw is EditFileInput {
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

function isInsideWorkspace(workspaceRoot: string, targetPath: string): boolean {
  const rel = relative(workspaceRoot, targetPath);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
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

function toWorkspacePath(workspaceRoot: string, targetPath: string): string {
  const rel = relative(workspaceRoot, targetPath);
  return rel || '.';
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
  action: EditFilePreview['action'],
): EditFilePreview {
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

function formatHunkRange(start: number, length: number): string {
  return length === 1 ? `${start}` : `${start},${length}`;
}
