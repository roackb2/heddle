// ---------------------------------------------------------------------------
// Tool: read_file
// ---------------------------------------------------------------------------

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ToolDefinition, ToolResult } from '../types.js';

type ReadFileInput = {
  path: string;
  maxLines?: number;
};

export const readFileTool: ToolDefinition = {
  name: 'read_file',
  description:
    'Read the contents of a file. Optionally limit to the first N lines with maxLines.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to the file to read',
      },
      maxLines: {
        type: 'number',
        description: 'Maximum number of lines to return (from the start of the file)',
      },
    },
    required: ['path'],
  },
  async execute(raw: unknown): Promise<ToolResult> {
    const input = raw as ReadFileInput;
    const filePath = resolve(input.path);

    try {
      const content = await readFile(filePath, 'utf-8');

      if (input.maxLines && input.maxLines > 0) {
        const lines = content.split('\n').slice(0, input.maxLines);
        return { ok: true, output: lines.join('\n') };
      }

      return { ok: true, output: content };
    } catch (err) {
      return { ok: false, error: `Failed to read ${filePath}: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
