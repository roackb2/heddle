// ---------------------------------------------------------------------------
// Tool: edit_file
// ---------------------------------------------------------------------------

import { resolve } from 'node:path';
import type { ToolDefinition, ToolResult } from '../../types.js';
import {
  executeScopedEdit,
  isScopedEditInput,
  previewScopedEdit,
} from './file-edit-core.js';

export type { ScopedEditInput as EditFileInput, EditPreview as EditFilePreview } from './file-edit-core.js';
import type { EditPreview } from './file-edit-core.js';

export const editFileTool: ToolDefinition = {
  name: 'edit_file',
  description:
    'Edit a file directly inside the current workspace without going through shell redirection or heredocs. Prefer this over shell commands when you need to create or change file contents. Use { "path", "oldText", "newText" } for an exact replacement, optionally with replaceAll, or use { "path", "content", "createIfMissing" } to overwrite an existing file or create a new one explicitly. This tool only writes inside the current workspace root and returns a structured edit summary.',
  requiresApproval: true,
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      path: {
        type: 'string',
        description: 'Workspace-relative path to the file to edit',
      },
      oldText: {
        type: 'string',
        description: 'Existing text to replace exactly',
      },
      newText: {
        type: 'string',
        description: 'Replacement text for oldText',
      },
      replaceAll: {
        type: 'boolean',
        description: 'Replace every matching occurrence instead of requiring a single exact match',
      },
      content: {
        type: 'string',
        description: 'Full file content to write',
      },
      createIfMissing: {
        type: 'boolean',
        description: 'Allow creating the file if it does not already exist when using content',
      },
    },
    required: ['path'],
  },
  async execute(raw: unknown): Promise<ToolResult> {
    return executeScopedEdit(raw, {
      toolName: 'edit_file',
      rootPath: process.cwd(),
      rootLabel: 'current workspace root',
      subjectLabel: 'file',
      creationHint: 'Set createIfMissing to true if you want edit_file to create it.',
    });
  },
};

export async function previewEditFileInput(raw: unknown, workspaceRoot: string = process.cwd()): Promise<EditPreview | undefined> {
  if (!isScopedEditInput(raw)) {
    return undefined;
  }

  return previewScopedEdit(raw, {
    toolName: 'edit_file',
    rootPath: resolve(workspaceRoot),
    rootLabel: 'current workspace root',
    subjectLabel: 'file',
  });
}
