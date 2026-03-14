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
    'Read the contents of a file. Use this when you already know the file path and want its contents, not when you want to inspect a directory. Optionally limit to the first N lines with maxLines.',
  parameters: {
    type: 'object',
    additionalProperties: false,
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
    if (!isReadFileInput(raw)) {
      return { ok: false, error: 'Invalid input for read_file. Required field: path. Optional field: maxLines.' };
    }

    const input: ReadFileInput = raw;
    const filePath = resolve(input.path);

    try {
      const content = await readFile(filePath, 'utf-8');

      if (input.maxLines && input.maxLines > 0) {
        const lines = content.split('\n').slice(0, input.maxLines);
        return { ok: true, output: lines.join('\n') };
      }

      return { ok: true, output: content };
    } catch (err) {
      if (err instanceof Error && 'code' in err && err.code === 'EISDIR') {
        return { ok: false, error: `Failed to read ${filePath}: path is a directory, not a file. Use list_files to inspect directories.` };
      }
      return { ok: false, error: `Failed to read ${filePath}: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};

function isReadFileInput(raw: unknown): raw is ReadFileInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return false;
  }

  const input = raw as Record<string, unknown>;
  const keys = Object.keys(input);
  if (keys.some((key) => key !== 'path' && key !== 'maxLines')) {
    return false;
  }

  if (typeof input.path !== 'string') {
    return false;
  }

  return input.maxLines === undefined || typeof input.maxLines === 'number';
}
