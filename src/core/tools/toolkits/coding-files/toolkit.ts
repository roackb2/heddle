import { createDeleteFileTool } from './delete-file.js';
import { createEditFileTool } from './edit-file.js';
import { createListFilesTool } from './list-files.js';
import { createMoveFileTool } from './move-file.js';
import { createReadFileTool } from './read-file.js';
import { createSearchFilesTool } from './search-files.js';
import type { ToolToolkit } from '../../toolkit.js';

export const codingFilesToolkit: ToolToolkit = {
  id: 'coding.files',
  createTools(context) {
    return [
      createListFilesTool({ workspaceRoot: context.workspaceRoot }),
      createReadFileTool({ workspaceRoot: context.workspaceRoot }),
      createEditFileTool({ workspaceRoot: context.workspaceRoot }),
      createDeleteFileTool({ workspaceRoot: context.workspaceRoot }),
      createMoveFileTool({ workspaceRoot: context.workspaceRoot }),
      createSearchFilesTool({
        excludedDirs: context.searchIgnoreDirs,
        workspaceRoot: context.workspaceRoot,
      }),
    ];
  },
};
