import type { ToolCall, ToolDefinition, ToolResult } from '@/core/types.js';
import type { ToolRegistry } from './registry.js';
import { ToolPolicyResolutionService } from './policy-envelope/index.js';

const DEFAULT_TIMEOUT_MS = 30_000;

export type ToolExecutionOptions = {
  signal?: AbortSignal;
  timeoutMs?: number | null;
};

/**
 * Executes tool calls against a registry with timeout/error normalization.
 */
export class ToolExecutionService {
  static async execute(
    registry: ToolRegistry,
    call: ToolCall,
    options: number | ToolExecutionOptions = {},
  ): Promise<ToolResult> {
    const tool = registry.get(call.tool);
    if (!tool) {
      return {
        ok: false,
        error: `Unknown tool: ${call.tool}. Available tools: ${registry.names().join(', ')}`,
      };
    }

    try {
      const resolvedOptions = typeof options === 'number' ? { timeoutMs: options } : options;
      const timeoutMs = ToolExecutionService.resolveTimeoutMs(tool, resolvedOptions);
      const timeoutController = new AbortController();
      const signal = resolvedOptions.signal
        ? AbortSignal.any([resolvedOptions.signal, timeoutController.signal])
        : timeoutController.signal;
      signal.throwIfAborted();

      const resolution = ToolPolicyResolutionService.resolve({
        tool,
        input: call.input,
      });
      if (resolution.error) {
        return {
          ok: false,
          error: resolution.error,
        };
      }

      const timeoutError = timeoutMs === null
        ? undefined
        : new Error(`Tool "${call.tool}" timed out after ${timeoutMs}ms`);
      let rejectOnAbort: (() => void) | undefined;
      const cancellation = new Promise<never>((_, reject) => {
        rejectOnAbort = () => reject(
          signal.reason instanceof Error
            ? signal.reason
            : new Error(`Tool "${call.tool}" was aborted`),
        );
        signal.addEventListener('abort', rejectOnAbort, { once: true });
      });
      const timer = timeoutMs === null
        ? undefined
        : setTimeout(() => timeoutController.abort(timeoutError), timeoutMs);

      try {
        return await Promise.race([
          tool.execute(resolution.toolInput, { signal }),
          cancellation,
        ]);
      } finally {
        if (timer !== undefined) {
          clearTimeout(timer);
        }
        if (rejectOnAbort) {
          signal.removeEventListener('abort', rejectOnAbort);
        }
      }
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private static resolveTimeoutMs(
    tool: ToolDefinition,
    options: ToolExecutionOptions,
  ): number | null {
    const timeoutMs = options.timeoutMs !== undefined
      ? options.timeoutMs
      : tool.timeoutMs !== undefined ? tool.timeoutMs : DEFAULT_TIMEOUT_MS;
    if (timeoutMs !== null && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
      throw new RangeError(
        `Tool "${tool.name}" timeoutMs must be null or a positive finite number`,
      );
    }
    return timeoutMs;
  }

}
