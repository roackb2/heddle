// ---------------------------------------------------------------------------
// Tool: search_files
// Uses grep — the real human tool, per project philosophy.
// ---------------------------------------------------------------------------

import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import type { ToolDefinition, ToolResult } from '../../../types.js';

type SearchFilesInput = {
  query: string;
  path?: string;
};

export const DEFAULT_SEARCH_EXCLUDED_DIRS = ['.git', 'dist', 'node_modules', 'local', '.heddle'];

export type SearchFilesOptions = {
  excludedDirs?: string[];
  workspaceRoot?: string;
};

export function createSearchFilesTool(options: SearchFilesOptions = {}): ToolDefinition {
  const excludedDirNames = sanitizeExcludedDirs(options.excludedDirs);
  const configuredWorkspaceRoot = options.workspaceRoot ? resolve(options.workspaceRoot) : undefined;

  return {
    name: 'search_files',
    description:
      'Search for a text pattern in files using grep. Use this when you need to locate a specific symbol or text string, not when a likely folder or file is already obvious from the workspace structure. Prefer searching for concrete terms such as tool names, symbols, or filenames rather than copying broad question text. Relative paths are resolved from the active workspace root and may also point to nearby parent or sibling folders. Returns newline-separated matches in grep-style path:line:content format, or "No matches found.". Ignores generated or state directories like .git, dist, node_modules, local, and .heddle by default, but if you explicitly target one of those directories via path then that path is searched. Example inputs: { "query": "createUser" }, { "query": "incident", "path": "../shared-notes" }',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: {
          type: 'string',
          description: 'The text pattern to search for',
        },
        path: {
          type: 'string',
          description: 'Directory to search in. Defaults to "."',
        },
      },
      required: ['query'],
    },
    async execute(raw: unknown): Promise<ToolResult> {
      if (!isSearchFilesInput(raw)) {
        return { ok: false, error: 'Invalid input for search_files. Required field: query. Optional field: path.' };
      }

      const input: SearchFilesInput = raw;
      const workspaceRoot = configuredWorkspaceRoot ?? process.cwd();
      const dir = resolve(workspaceRoot, input.path ?? '.');
      const effectiveExcludedDirs = excludedDirNames.filter((name) => !isExplicitlyTargetingExcludedDir(dir, name));
      const excludedDirs = effectiveExcludedDirs.map((name) => `--exclude-dir=${escapeShellArg(name)}`).join(' ');

      try {
        // -r recursive, -n line numbers, -I skip binary, --include common text files
        const output = execSync(
          `grep -rnI ${excludedDirs} --include='*.ts' --include='*.js' --include='*.json' --include='*.md' --include='*.txt' --include='*.yaml' --include='*.yml' ${escapeShellArg(input.query)} ${escapeShellArg(dir)}`,
          { encoding: 'utf-8', timeout: 15_000, maxBuffer: 1024 * 1024 },
        );
        return { ok: true, output: output.trim() };
      } catch (err) {
        if (err && typeof err === 'object' && 'status' in err && err.status === 1) {
          return { ok: true, output: 'No matches found.' };
        }
        return { ok: false, error: `Search failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  };
}

export const searchFilesTool: ToolDefinition = createSearchFilesTool();

function isSearchFilesInput(raw: unknown): raw is SearchFilesInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return false;
  }

  const input = raw as Record<string, unknown>;
  const keys = Object.keys(input);
  if (keys.some((key) => key !== 'query' && key !== 'path')) {
    return false;
  }

  if (typeof input.query !== 'string') {
    return false;
  }

  return input.path === undefined || typeof input.path === 'string';
}

function escapeShellArg(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

function sanitizeExcludedDirs(custom: string[] | undefined): string[] {
  if (!custom || custom.length === 0) {
    return DEFAULT_SEARCH_EXCLUDED_DIRS;
  }

  const normalized = custom
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => value.replace(/^\.?\//, '').replace(/\/+$/, ''));

  return normalized.length > 0 ? normalized : DEFAULT_SEARCH_EXCLUDED_DIRS;
}

function isExplicitlyTargetingExcludedDir(dir: string, excludedName: string): boolean {
  const normalizedExcludedName = excludedName.trim().replace(/^\.?\//, '').replace(/\/+$/, '');
  if (!normalizedExcludedName) {
    return false;
  }

  const segments = dir.split(/[/\\]+/).filter(Boolean);
  return segments.includes(normalizedExcludedName);
}
