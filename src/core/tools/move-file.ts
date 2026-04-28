import { mkdir, rename, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { ToolDefinition, ToolResult } from '../types.js';

type MoveFileInput = {
  from: string;
  to: string;
  createParentDirs?: boolean;
};

export type MoveFileToolOptions = {
  workspaceRoot?: string;
};

export function createMoveFileTool(options: MoveFileToolOptions = {}): ToolDefinition {
  const configuredWorkspaceRoot = options.workspaceRoot ? resolve(options.workspaceRoot) : undefined;

  return {
    name: 'move_file',
    description:
      'Move or rename a file or directory within the workspace when you need a direct file operation without shell mv. Use this for renames, relocations, or cleanup moves. Relative paths are resolved from the active workspace root and may also point to nearby parent or sibling folders. Optionally create missing destination parent directories with createParentDirs. Returns a structured move summary.',
    requiresApproval: true,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        from: {
          type: 'string',
          description: 'Existing path to move from',
        },
        to: {
          type: 'string',
          description: 'Destination path to move to',
        },
        createParentDirs: {
          type: 'boolean',
          description: 'Create destination parent directories if they are missing',
        },
      },
      required: ['from', 'to'],
    },
    async execute(raw: unknown): Promise<ToolResult> {
      if (!isMoveFileInput(raw)) {
        return {
          ok: false,
          error: 'Invalid input for move_file. Required fields: from, to. Optional field: createParentDirs.',
        };
      }

      const workspaceRoot = configuredWorkspaceRoot ?? process.cwd();
      const fromPath = resolve(workspaceRoot, raw.from);
      const toPath = resolve(workspaceRoot, raw.to);

      try {
        const info = await stat(fromPath);
        if (raw.createParentDirs) {
          await mkdir(dirname(toPath), { recursive: true });
        }

        await rename(fromPath, toPath);

        return {
          ok: true,
          output: {
            from: fromPath,
            to: toPath,
            moved: true,
            kind: info.isDirectory() ? 'directory' : 'file',
            createdParentDirs: Boolean(raw.createParentDirs),
          },
        };
      } catch (error) {
        return {
          ok: false,
          error: `Failed to move ${fromPath} to ${toPath}: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  };
}

export const moveFileTool: ToolDefinition = createMoveFileTool();

function isMoveFileInput(raw: unknown): raw is MoveFileInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return false;
  }

  const input = raw as Record<string, unknown>;
  const keys = Object.keys(input);
  if (keys.some((key) => key !== 'from' && key !== 'to' && key !== 'createParentDirs')) {
    return false;
  }

  if (typeof input.from !== 'string' || input.from.trim().length === 0) {
    return false;
  }

  if (typeof input.to !== 'string' || input.to.trim().length === 0) {
    return false;
  }

  return input.createParentDirs === undefined || typeof input.createParentDirs === 'boolean';
}
