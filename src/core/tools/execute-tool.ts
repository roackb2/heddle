import type { ToolCall, ToolResult } from '@/core/types.js';
import type { ToolRegistry } from './registry.js';

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Executes tool calls against a registry with timeout/error normalization.
 */
export class ToolExecutionService {
  static async execute(
    registry: ToolRegistry,
    call: ToolCall,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<ToolResult> {
    const tool = registry.get(call.tool);
    if (!tool) {
      return {
        ok: false,
        error: `Unknown tool: ${call.tool}. Available tools: ${registry.names().join(', ')}`,
      };
    }

    try {
      const result = await Promise.race([
        tool.execute(call.input),
        new Promise<ToolResult>((_, reject) =>
          setTimeout(() => reject(new Error(`Tool "${call.tool}" timed out after ${timeoutMs}ms`)), timeoutMs),
        ),
      ]);
      return result;
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
