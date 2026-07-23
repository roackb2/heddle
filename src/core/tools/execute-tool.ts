import type { ToolCall, ToolResult } from '@/core/types.js';
import type { ToolRegistry } from './registry.js';
import { ToolPolicyEnvelopeInputService } from './policy-envelope/index.js';

const DEFAULT_TIMEOUT_MS = 30_000;

export type ToolExecutionOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
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
      const timeoutMs = resolvedOptions.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const timeoutController = new AbortController();
      const signal = resolvedOptions.signal
        ? AbortSignal.any([resolvedOptions.signal, timeoutController.signal])
        : timeoutController.signal;
      signal.throwIfAborted();

      const extraction = ToolPolicyEnvelopeInputService.extract(call.input);
      if (extraction.error) {
        return {
          ok: false,
          error: extraction.error,
        };
      }

      const timeoutError = new Error(`Tool "${call.tool}" timed out after ${timeoutMs}ms`);
      let rejectOnAbort: (() => void) | undefined;
      const cancellation = new Promise<never>((_, reject) => {
        rejectOnAbort = () => reject(
          signal.reason instanceof Error
            ? signal.reason
            : new Error(`Tool "${call.tool}" was aborted`),
        );
        signal.addEventListener('abort', rejectOnAbort, { once: true });
      });
      const timer = setTimeout(() => timeoutController.abort(timeoutError), timeoutMs);

      try {
        return await Promise.race([
          tool.execute(extraction.toolInput, { signal }),
          cancellation,
        ]);
      } finally {
        clearTimeout(timer);
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
}
