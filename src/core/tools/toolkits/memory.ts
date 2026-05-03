import {
  createEditMemoryNoteTool,
  createListMemoryNotesTool,
  createReadMemoryNoteTool,
  createSearchMemoryNotesTool,
} from '../memory-notes.js';
import { createMemoryCheckpointTool } from '../memory-checkpoint.js';
import { createRecordKnowledgeTool } from '../record-knowledge.js';
import type { ToolToolkit } from '../toolkit.js';

export const memoryToolkit: ToolToolkit = {
  id: 'memory',
  createTools(context) {
    if (context.memoryMode === 'none') {
      return [];
    }

    const readTools = [
      createListMemoryNotesTool({ memoryRoot: context.memoryDir }),
      createReadMemoryNoteTool({ memoryRoot: context.memoryDir }),
      createSearchMemoryNotesTool({ memoryRoot: context.memoryDir }),
    ];

    if (context.memoryMode === 'read-and-record') {
      return [
        ...readTools,
        createMemoryCheckpointTool({ memoryRoot: context.memoryDir }),
        createRecordKnowledgeTool({ memoryRoot: context.memoryDir }),
      ];
    }

    if (context.memoryMode === 'maintainer' || context.memoryMode === 'legacy-full') {
      return [...readTools, createEditMemoryNoteTool({ memoryRoot: context.memoryDir })];
    }

    const exhaustive: never = context.memoryMode;
    throw new Error(`Unsupported memory mode: ${exhaustive}`);
  },
};
