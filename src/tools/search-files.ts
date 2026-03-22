// ---------------------------------------------------------------------------
// Tool: search_files
// Uses grep — the real human tool, per project philosophy.
// ---------------------------------------------------------------------------

import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import type { ToolDefinition, ToolResult } from '../types.js';

type SearchFilesInput = {
  query: string;
  path?: string;
};

const DEFAULT_EXCLUDED_DIRS = ['.git', 'dist', 'node_modules', 'local'];

export const searchFilesTool: ToolDefinition = {
  name: 'search_files',
  description:
    'Search for a text pattern in files using grep. Use this when you need to locate a specific symbol or text string, not when a likely folder or file is already obvious from the workspace structure. Prefer searching for concrete terms such as tool names, symbols, or filenames rather than copying broad question text. Returns newline-separated matches in grep-style path:line:content format, or "No matches found.". Ignores generated directories like .git, dist, node_modules, and local. Example input: { "query": "createUser" }',
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
    const dir = resolve(input.path ?? '.');
    const excludedDirs = DEFAULT_EXCLUDED_DIRS.map((name) => `--exclude-dir=${escapeShellArg(name)}`).join(' ');

    try {
      // -r recursive, -n line numbers, -I skip binary, --include common text files
      const output = execSync(
        `grep -rnI ${excludedDirs} --include='*.ts' --include='*.js' --include='*.json' --include='*.md' --include='*.txt' --include='*.yaml' --include='*.yml' ${escapeShellArg(input.query)} ${escapeShellArg(dir)}`,
        { encoding: 'utf-8', timeout: 15_000, maxBuffer: 1024 * 1024 },
      );
      return { ok: true, output: output.trim() };
    } catch (err) {
      // grep exits with code 1 when no matches found — that's not an error
      if (err && typeof err === 'object' && 'status' in err && err.status === 1) {
        return { ok: true, output: 'No matches found.' };
      }
      return { ok: false, error: `Search failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};

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
