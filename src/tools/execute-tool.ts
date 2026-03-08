// ---------------------------------------------------------------------------
// Tool Executor
// ---------------------------------------------------------------------------

import type { ToolCall, ToolResult } from '../types.js';
import type { ToolRegistry } from './registry.js';

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Execute a tool call against the registry.
 * Wraps execution in try/catch and applies a timeout.
 */
export async function executeTool(
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
