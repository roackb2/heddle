import { access, readdir, readFile, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import type { ToolDefinition, ToolResult } from '../types.js';
import { executeScopedEdit } from './file-edit-core.js';

export type MemoryNotesToolOptions = {
  memoryRoot?: string;
};

type ListMemoryNotesInput = {
  path?: string;
};

type ReadMemoryNoteInput = {
  path: string;
  maxLines?: number;
  offset?: number;
};

type SearchMemoryNotesInput = {
  query: string;
  path?: string;
  maxResults?: number;
};

const DEFAULT_MEMORY_ROOT = resolve(process.cwd(), '.heddle', 'memory');
const DEFAULT_MAX_SEARCH_RESULTS = 100;

export function createListMemoryNotesTool(options: MemoryNotesToolOptions = {}): ToolDefinition {
  return {
    name: 'list_memory_notes',
    description:
      'List markdown notes inside Heddle-managed persistent memory under .heddle/memory. Use this to follow the catalog discovery path for durable preferences, workflows, current-state handoff, operational conventions, relationships, history, and other reusable agent context. Optional field: path, relative to the memory root, to limit listing to a subdirectory. Returns relative note paths. Example inputs: {}, { "path": "." }, { "path": "preferences" }.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: {
          type: 'string',
          description: 'Optional memory-relative subdirectory to list from',
        },
      },
    },
    async execute(raw: unknown): Promise<ToolResult> {
      if (!isListMemoryNotesInput(raw)) {
        return { ok: false, error: 'Invalid input for list_memory_notes. Optional field: path.' };
      }

      const memoryRoot = resolveMemoryRoot(options);
      const targetPath = resolveMemoryPath(memoryRoot, raw.path ?? '.');
      if (!targetPath.ok) {
        return { ok: false, error: targetPath.error };
      }

      const exists = await pathExists(targetPath.path);
      if (!exists) {
        return { ok: true, output: '' };
      }

      try {
        const info = await stat(targetPath.path);
        if (info.isFile()) {
          return {
            ok: true,
            output: toMemoryRelativePath(memoryRoot, targetPath.path),
          };
        }

        const entries = await listMarkdownNotes(targetPath.path);
        return {
          ok: true,
          output: entries.map((entry) => toMemoryRelativePath(memoryRoot, entry)).join('\n'),
        };
      } catch (error) {
        return {
          ok: false,
          error: `Failed to list memory notes in ${targetPath.path}: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  };
}

export function createReadMemoryNoteTool(options: MemoryNotesToolOptions = {}): ToolDefinition {
  return {
    name: 'read_memory_note',
    description:
      'Read a Heddle-managed persistent memory note from .heddle/memory. Prefer reading README.md catalogs first, then focused notes linked from those catalogs. Use this for durable agent context such as user/team preferences, task formats, workflows, current-state handoff, operational knowledge, relationships, history, known issues, or common commands. Optional fields: maxLines and offset for paging long notes. The path must stay inside the memory root. Example inputs: { "path": "README.md" }, { "path": "preferences/README.md" }, { "path": "preferences/ticket-format.md" }.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: {
          type: 'string',
          description: 'Memory-relative path to the note',
        },
        maxLines: {
          type: 'number',
          description: 'Maximum number of lines to return',
        },
        offset: {
          type: 'number',
          description: '0-based line offset to start from',
        },
      },
      required: ['path'],
    },
    async execute(raw: unknown): Promise<ToolResult> {
      if (!isReadMemoryNoteInput(raw)) {
        return { ok: false, error: 'Invalid input for read_memory_note. Required field: path. Optional fields: maxLines, offset.' };
      }

      const memoryRoot = resolveMemoryRoot(options);
      const targetPath = resolveMemoryPath(memoryRoot, raw.path);
      if (!targetPath.ok) {
        return { ok: false, error: targetPath.error };
      }

      try {
        const content = await readFile(targetPath.path, 'utf8');
        return {
          ok: true,
          output: pageText(content, raw.offset, raw.maxLines),
        };
      } catch (error) {
        if (isErrorWithCode(error, 'EISDIR')) {
          return {
            ok: false,
            error: `Failed to read ${targetPath.path}: path is a directory, not a file. Use list_memory_notes to inspect memory directories.`,
          };
        }

        return {
          ok: false,
          error: `Failed to read ${targetPath.path}: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  };
}

export function createSearchMemoryNotesTool(options: MemoryNotesToolOptions = {}): ToolDefinition {
  return {
    name: 'search_memory_notes',
    description:
      'Search Heddle-managed markdown memory under .heddle/memory. Use this before broad repo search when the user asks about durable preferences, ticket/response formats, workflows, recurring operational patterns, current-state handoff, relationships, or history and you do not yet know the right catalog path. Input example: { "query": "ticket" }. Optional fields: path to limit the search to a subdirectory or note, and maxResults to cap returned lines. Returns grep-style path:line:content output or "No matches found.".',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: {
          type: 'string',
          description: 'Text to search for in memory notes',
        },
        path: {
          type: 'string',
          description: 'Optional memory-relative subdirectory or note path to search within',
        },
        maxResults: {
          type: 'number',
          description: 'Maximum number of matching lines to return',
        },
      },
      required: ['query'],
    },
    async execute(raw: unknown): Promise<ToolResult> {
      if (!isSearchMemoryNotesInput(raw)) {
        return { ok: false, error: 'Invalid input for search_memory_notes. Required field: query. Optional fields: path, maxResults.' };
      }

      const memoryRoot = resolveMemoryRoot(options);
      const targetPath = resolveMemoryPath(memoryRoot, raw.path ?? '.');
      if (!targetPath.ok) {
        return { ok: false, error: targetPath.error };
      }

      const exists = await pathExists(targetPath.path);
      if (!exists) {
        return { ok: true, output: 'No matches found.' };
      }

      const searchResult = await searchWithCli(memoryRoot, targetPath.path, raw.query, sanitizeMaxResults(raw.maxResults));
      return searchResult;
    },
  };
}

export function createEditMemoryNoteTool(options: MemoryNotesToolOptions = {}): ToolDefinition {
  return {
    name: 'edit_memory_note',
    description:
      'Create or edit a persistent markdown note inside .heddle/memory. Use this for stable reusable project knowledge that should survive future sessions. Use { "path", "oldText", "newText" } for an exact replacement, optionally with replaceAll, or use { "path", "content", "createIfMissing" } to overwrite an existing note or create a new one explicitly. This tool does not require approval; you should maintain durable memory proactively at sensible checkpoints. If the built-in edit flow is insufficient, it is acceptable to use mature shell tools against the memory directory.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: {
          type: 'string',
          description: 'Memory-relative markdown note path',
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
          description: 'Full note content to write',
        },
        createIfMissing: {
          type: 'boolean',
          description: 'Allow creating the note if it does not already exist when using content',
        },
      },
      required: ['path'],
    },
    async execute(raw: unknown): Promise<ToolResult> {
      return executeScopedEdit(raw, {
        toolName: 'edit_memory_note',
        rootPath: resolveMemoryRoot(options),
        rootLabel: 'memory root',
        subjectLabel: 'memory note',
        creationHint: 'Set createIfMissing to true if you want edit_memory_note to create it.',
        enforceRoot: true,
      });
    },
  };
}

export const listMemoryNotesTool = createListMemoryNotesTool();
export const readMemoryNoteTool = createReadMemoryNoteTool();
export const searchMemoryNotesTool = createSearchMemoryNotesTool();
export const editMemoryNoteTool = createEditMemoryNoteTool();

function resolveMemoryRoot(options: MemoryNotesToolOptions): string {
  return resolve(options.memoryRoot ?? DEFAULT_MEMORY_ROOT);
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
  const results: string[] = [];
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const nextPath = resolve(root, entry.name);
    if (entry.isDirectory()) {
      results.push(...await listMarkdownNotes(nextPath));
      continue;
    }

    if (entry.isFile() && isMarkdownPath(nextPath)) {
      results.push(nextPath);
    }
  }

  return results.sort();
}

function pageText(content: string, offset?: number, maxLines?: number): string {
  const lines = content.split('\n');
  const start = offset && offset > 0 ? Math.floor(offset) : 0;
  const end = maxLines && maxLines > 0 ? start + Math.floor(maxLines) : undefined;
  if (start > 0 || end !== undefined) {
    return lines.slice(start, end).join('\n');
  }

  return content;
}

function sanitizeMaxResults(value: number | undefined): number {
  if (!value || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_MAX_SEARCH_RESULTS;
  }

  return Math.min(Math.floor(value), DEFAULT_MAX_SEARCH_RESULTS);
}

function toMemoryRelativePath(memoryRoot: string, filePath: string): string {
  const rel = relative(memoryRoot, filePath);
  return rel || '.';
}

function isMarkdownPath(path: string): boolean {
  return /\.md$/i.test(path);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function isListMemoryNotesInput(raw: unknown): raw is ListMemoryNotesInput {
  if (raw === undefined) {
    return true;
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return false;
  }

  const input = raw as Record<string, unknown>;
  const keys = Object.keys(input);
  if (keys.some((key) => key !== 'path')) {
    return false;
  }

  return input.path === undefined || typeof input.path === 'string';
}

function isReadMemoryNoteInput(raw: unknown): raw is ReadMemoryNoteInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return false;
  }

  const input = raw as Record<string, unknown>;
  const keys = Object.keys(input);
  if (keys.some((key) => key !== 'path' && key !== 'maxLines' && key !== 'offset')) {
    return false;
  }

  return (
    typeof input.path === 'string' &&
    (input.maxLines === undefined || typeof input.maxLines === 'number') &&
    (input.offset === undefined || typeof input.offset === 'number')
  );
}

function isSearchMemoryNotesInput(raw: unknown): raw is SearchMemoryNotesInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return false;
  }

  const input = raw as Record<string, unknown>;
  const keys = Object.keys(input);
  if (keys.some((key) => key !== 'query' && key !== 'path' && key !== 'maxResults')) {
    return false;
  }

  return (
    typeof input.query === 'string' &&
    input.query.trim().length > 0 &&
    (input.path === undefined || typeof input.path === 'string') &&
    (input.maxResults === undefined || typeof input.maxResults === 'number')
  );
}

function isErrorWithCode(error: unknown, code: string): error is Error & { code: string } {
  return error instanceof Error && 'code' in error && error.code === code;
}

async function searchWithCli(memoryRoot: string, targetPath: string, query: string, maxResults: number): Promise<ToolResult> {
  const relativeTarget = toMemoryRelativePath(memoryRoot, targetPath);
  const normalizedTarget = relativeTarget === '.' ? '.' : relativeTarget;

  const rgResult = await runSearchCommand('rg', ['-n', '--no-heading', '--glob', '*.md', query, normalizedTarget], memoryRoot);
  if (rgResult.kind === 'ok') {
    return {
      ok: true,
      output: trimSearchOutput(rgResult.stdout, maxResults),
    };
  }

  if (rgResult.kind === 'nonzero_no_match') {
    return { ok: true, output: 'No matches found.' };
  }

  if (rgResult.kind !== 'missing_binary') {
    return {
      ok: false,
      error: `Failed to search memory notes in ${targetPath}: ${rgResult.error}`,
    };
  }

  const grepResult = await runSearchCommand('grep', ['-R', '-n', '--include=*.md', query, normalizedTarget], memoryRoot);
  if (grepResult.kind === 'ok') {
    return {
      ok: true,
      output: trimSearchOutput(grepResult.stdout, maxResults),
    };
  }

  if (grepResult.kind === 'nonzero_no_match') {
    return { ok: true, output: 'No matches found.' };
  }

  return {
    ok: false,
    error: `Failed to search memory notes in ${targetPath}: ${grepResult.error}`,
  };
}

function trimSearchOutput(stdout: string, maxResults: number): string {
  const lines = stdout
    .split('\n')
    .map((line) => line.trimEnd().replace(/^\.\//, ''))
    .filter((line) => line.length > 0)
    .slice(0, maxResults);
  return lines.length > 0 ? lines.join('\n') : 'No matches found.';
}

async function runSearchCommand(
  binary: string,
  args: string[],
  cwd: string,
): Promise<
  | { kind: 'ok'; stdout: string }
  | { kind: 'missing_binary'; error: string }
  | { kind: 'nonzero_no_match'; error: string }
  | { kind: 'error'; error: string }
> {
  return new Promise((resolvePromise) => {
    const child = spawn(binary, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      if ('code' in error && error.code === 'ENOENT') {
        resolvePromise({ kind: 'missing_binary', error: `${binary} is not available in the environment.` });
        return;
      }

      resolvePromise({ kind: 'error', error: error.message });
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolvePromise({ kind: 'ok', stdout });
        return;
      }

      if (code === 1) {
        resolvePromise({ kind: 'nonzero_no_match', error: stderr.trim() || `${binary} returned exit code 1` });
        return;
      }

      resolvePromise({ kind: 'error', error: stderr.trim() || `${binary} returned exit code ${code ?? 'unknown'}` });
    });
  });
}
