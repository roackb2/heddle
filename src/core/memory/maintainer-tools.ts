import type { ToolDefinition } from '../types.js';
import {
  createEditMemoryNoteTool,
  createListMemoryNotesTool,
  createReadMemoryNoteTool,
  createSearchMemoryNotesTool,
} from '../tools/toolkits/knowledge/memory-notes.js';

export function createMemoryMaintainerTools(options: { memoryRoot: string }): ToolDefinition[] {
  return [
    createListMemoryNotesTool({ memoryRoot: options.memoryRoot }),
    createReadMemoryNoteTool({ memoryRoot: options.memoryRoot }),
    createSearchMemoryNotesTool({ memoryRoot: options.memoryRoot }),
    createEditMemoryNoteTool({ memoryRoot: options.memoryRoot }),
  ];
}
