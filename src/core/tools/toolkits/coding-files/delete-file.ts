import { rm, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ToolDefinition, ToolResult } from '../../../types.js';

type DeleteFileInput = {
  path: string;
  recursive?: boolean;
};

export type DeleteFileToolOptions = {
  workspaceRoot?: string;
};

export function createDeleteFileTool(options: DeleteFileToolOptions = {}): ToolDefinition {
  const configuredWorkspaceRoot = options.workspaceRoot ? resolve(options.workspaceRoot) : undefined;

  return {
    name: 'delete_file',
    description:
      'Delete a file or remove a directory when you explicitly need to clean up or retire workspace content. Prefer this over shell rm for normal file deletion. Use { "path" } for files, or set recursive to true if you intentionally want to remove a directory tree. Relative paths are resolved from the active workspace root and may also point to nearby parent or sibling folders. Returns a structured deletion summary.',
    requiresApproval: true,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: {
          type: 'string',
          description: 'Path to the file or directory to delete',
        },
        recursive: {
          type: 'boolean',
          description: 'Allow deleting a directory tree recursively',
        },
      },
      required: ['path'],
    },
    async execute(raw: unknown): Promise<ToolResult> {
      if (!isDeleteFileInput(raw)) {
        return {
          ok: false,
          error: 'Invalid input for delete_file. Required field: path. Optional field: recursive.',
        };
      }

      const workspaceRoot = configuredWorkspaceRoot ?? process.cwd();
      const targetPath = resolve(workspaceRoot, raw.path);

      try {
        const info = await stat(targetPath);
        if (info.isDirectory() && !raw.recursive) {
          return {
            ok: false,
            error: `Refusing to delete directory ${targetPath} without recursive: true.`,
          };
        }

        await rm(targetPath, {
          recursive: Boolean(raw.recursive),
          force: false,
        });

        return {
          ok: true,
          output: {
            path: targetPath,
            deleted: true,
            kind: info.isDirectory() ? 'directory' : 'file',
            recursive: Boolean(raw.recursive),
          },
        };
      } catch (error) {
        return {
          ok: false,
          error: `Failed to delete ${targetPath}: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  };
}

export const deleteFileTool: ToolDefinition = createDeleteFileTool();

function isDeleteFileInput(raw: unknown): raw is DeleteFileInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return false;
  }

  const input = raw as Record<string, unknown>;
  const keys = Object.keys(input);
  if (keys.some((key) => key !== 'path' && key !== 'recursive')) {
    return false;
  }

  if (typeof input.path !== 'string' || input.path.trim().length === 0) {
    return false;
  }

  return input.recursive === undefined || typeof input.recursive === 'boolean';
}
