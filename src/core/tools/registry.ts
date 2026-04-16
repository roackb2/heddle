// ---------------------------------------------------------------------------
// Tool Registry
// ---------------------------------------------------------------------------

import type { ToolDefinition } from '../types.js';

export type ToolRegistry = {
  get(name: string): ToolDefinition | undefined;
  list(): ToolDefinition[];
  names(): string[];
};

/**
 * Create a registry from an array of tool definitions.
 */
export function createToolRegistry(tools: ToolDefinition[]): ToolRegistry {
  const map = new Map<string, ToolDefinition>();
  for (const tool of tools) {
    if (map.has(tool.name)) {
      throw new Error(`Duplicate tool name: ${tool.name}`);
    }
    map.set(tool.name, tool);
  }

  return {
    get(name: string) {
      return map.get(name);
    },
    list() {
      return [...map.values()];
    },
    names() {
      return [...map.keys()];
    },
  };
}
