// ---------------------------------------------------------------------------
// Tool: list_files
// ---------------------------------------------------------------------------

import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ToolDefinition, ToolResult } from '../types.js';

type ListFilesInput = {
  path?: string;
};

export const listFilesTool: ToolDefinition = {
  name: 'list_files',
  description:
    'List files and directories at the given path. Defaults to the current working directory. Returns a flat list of names. Directories end with /.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Directory path to list. Defaults to "."',
      },
    },
  },
  async execute(raw: unknown): Promise<ToolResult> {
    const input = raw as ListFilesInput;
    const dir = resolve(input.path ?? '.');

    try {
      const entries = await readdir(dir, { withFileTypes: true });
      const names = entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
      return { ok: true, output: names.join('\n') };
    } catch (err) {
      return { ok: false, error: `Failed to list ${dir}: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
