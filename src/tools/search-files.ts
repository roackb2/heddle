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

export const searchFilesTool: ToolDefinition = {
  name: 'search_files',
  description:
    'Search for a text pattern in files using grep. Returns matching lines with file paths and line numbers.',
  parameters: {
    type: 'object',
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
    const input = raw as SearchFilesInput;
    const dir = resolve(input.path ?? '.');

    try {
      // -r recursive, -n line numbers, -I skip binary, --include common text files
      const output = execSync(
        `grep -rnI --include='*.ts' --include='*.js' --include='*.json' --include='*.md' --include='*.txt' --include='*.yaml' --include='*.yml' ${escapeShellArg(input.query)} ${escapeShellArg(dir)}`,
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

function escapeShellArg(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`;
}
