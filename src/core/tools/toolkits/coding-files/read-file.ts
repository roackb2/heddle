// ---------------------------------------------------------------------------
// Tool: read_file
// ---------------------------------------------------------------------------

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ToolDefinition, ToolResult } from '../../../types.js';

type ReadFileInput = {
  path: string;
  maxLines?: number;
  offset?: number;
};

export type ReadFileToolOptions = {
  workspaceRoot?: string;
};

export function createReadFileTool(options: ReadFileToolOptions = {}): ToolDefinition {
  const configuredWorkspaceRoot = options.workspaceRoot ? resolve(options.workspaceRoot) : undefined;

  return {
    name: 'read_file',
    description:
      'Read the contents of a file. Use this when you already know the file path and want its contents, not when you want to inspect a directory. Relative paths are resolved from the active workspace root and may also point to nearby parent or sibling folders. Optionally limit returned lines with maxLines and start from a 0-based line offset with offset, which is useful for paging through long files. Returns the file text directly, or just the selected window when maxLines and/or offset are provided. Example inputs: { "path": "path/to/file.txt" }, { "path": "../shared-notes/summary.md" }, { "path": "src/run-agent.ts", "offset": 200, "maxLines": 120 }',
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
          description: 'Maximum number of lines to return',
        },
        offset: {
          type: 'number',
          description: '0-based line offset to start reading from',
        },
      },
      required: ['path'],
    },
    async execute(raw: unknown): Promise<ToolResult> {
      if (!isReadFileInput(raw)) {
        return { ok: false, error: 'Invalid input for read_file. Required field: path. Optional fields: maxLines, offset.' };
      }

      const input: ReadFileInput = raw;
      const workspaceRoot = configuredWorkspaceRoot ?? process.cwd();
      const filePath = resolve(workspaceRoot, input.path);

      try {
        const content = await readFile(filePath, 'utf-8');

        const lines = content.split('\n');
        const start = input.offset && input.offset > 0 ? Math.floor(input.offset) : 0;

        if ((input.maxLines && input.maxLines > 0) || start > 0) {
          const end = input.maxLines && input.maxLines > 0 ? start + Math.floor(input.maxLines) : undefined;
          const windowedLines = lines.slice(start, end);
          const joined = windowedLines.join('\n');
          if (content.endsWith('\n') && windowedLines.length > 0 && end !== undefined && end < lines.length) {
            return { ok: true, output: joined };
          }
          return { ok: true, output: joined };
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
}

export const readFileTool: ToolDefinition = createReadFileTool();

function isReadFileInput(raw: unknown): raw is ReadFileInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return false;
  }

  const input = raw as Record<string, unknown>;
  const keys = Object.keys(input);
  if (keys.some((key) => key !== 'path' && key !== 'maxLines' && key !== 'offset')) {
    return false;
  }

  if (typeof input.path !== 'string') {
    return false;
  }

  const validMaxLines = input.maxLines === undefined || typeof input.maxLines === 'number';
  const validOffset = input.offset === undefined || typeof input.offset === 'number';
  return validMaxLines && validOffset;
}
