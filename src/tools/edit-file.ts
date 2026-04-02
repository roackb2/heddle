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
    },
  };
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
