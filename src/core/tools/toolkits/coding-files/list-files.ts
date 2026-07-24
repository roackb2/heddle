// ---------------------------------------------------------------------------
// Tool: list_files
// ---------------------------------------------------------------------------

import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ToolDefinition, ToolResult } from '../../../types.js';
import { WorkspacePathPolicy } from './workspace-path-policy.js';

type ListFilesInput = {
  path?: string;
};

export type ListFilesToolOptions = {
  workspaceRoot?: string;
};

export function createListFilesTool(options: ListFilesToolOptions = {}): ToolDefinition {
  const configuredWorkspaceRoot = options.workspaceRoot ? resolve(options.workspaceRoot) : undefined;

  return {
    name: 'list_files',
    concurrency: 'parallel-safe',
    description:
      'List files and directories inside the active workspace. Use this to inspect folders, not to read file contents. Prefer this when you need an initial view of the workspace or want to explore an obvious folder before using broader search. Relative paths are resolved from the active workspace root, and canonical path checks reject parent traversal or symlinks that escape it. Defaults to the active workspace root. Returns a flat newline-separated list of entry names; directories end with /. Example input: { "path": "." }',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: {
          type: 'string',
          description: 'Directory path to list. Defaults to "."',
        },
      },
    },
    async execute(raw: unknown): Promise<ToolResult> {
      if (!isListFilesInput(raw)) {
        return { ok: false, error: 'Invalid input for list_files. Allowed fields: path. Example: { "path": "." }' };
      }

      const input: ListFilesInput = raw;
      const workspaceRoot = configuredWorkspaceRoot ?? process.cwd();
      const requestedPath = resolve(workspaceRoot, input.path ?? '.');

      try {
        const { canonicalPath: dir } = await WorkspacePathPolicy.resolveExisting({
          workspaceRoot,
          path: input.path ?? '.',
        });
        const entries = await readdir(dir, { withFileTypes: true });
        const names = entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
        return { ok: true, output: names.join('\n') };
      } catch (err) {
        if (err instanceof Error && 'code' in err && err.code === 'ENOTDIR') {
          return { ok: false, error: `Failed to list ${requestedPath}: path is a file, not a directory. Use read_file for file contents.` };
        }
        return { ok: false, error: `Failed to list ${requestedPath}: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  };
}

export const listFilesTool: ToolDefinition = createListFilesTool();

function isListFilesInput(raw: unknown): raw is ListFilesInput {
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
