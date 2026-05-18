import type { ToolDefinition } from '@/core/types.js';

/**
 * Registry for the executable tool set available to one agent run.
 */
export class ToolRegistry {
  private readonly toolMap = new Map<string, ToolDefinition>();

  constructor(tools: ToolDefinition[]) {
    for (const tool of tools) {
      if (this.toolMap.has(tool.name)) {
        throw new Error(`Duplicate tool name: ${tool.name}`);
      }
      this.toolMap.set(tool.name, tool);
    }
  }

  get(name: string): ToolDefinition | undefined {
    return this.toolMap.get(name);
  }

  list(): ToolDefinition[] {
    return [...this.toolMap.values()];
  }

  names(): string[] {
    return [...this.toolMap.keys()];
  }
}
