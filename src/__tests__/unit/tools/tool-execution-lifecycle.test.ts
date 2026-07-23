import { describe, expect, it, vi } from 'vitest';
import { ToolExecutionService, ToolRegistry } from '@/core/tools/index.js';
import type { ToolDefinition } from '@/core/types.js';

function registry(execute: ToolDefinition['execute']): ToolRegistry {
  return new ToolRegistry([{
    name: 'lifecycle_tool',
    description: 'Exercise tool lifecycle behavior.',
    parameters: { type: 'object', properties: {} },
    execute,
  }]);
}

describe('tool execution lifecycle', () => {
  it('clears the timeout after successful execution', async () => {
    vi.useFakeTimers();

    try {
      await expect(ToolExecutionService.execute(
        registry(async () => ({ ok: true })),
        { id: 'call-1', tool: 'lifecycle_tool', input: {} },
      )).resolves.toEqual({ ok: true });

      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('aborts the tool and clears the timeout when the owning run is cancelled', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    let toolSignal: AbortSignal | undefined;

    try {
      const execution = ToolExecutionService.execute(
        registry(async (_input, context) => {
          toolSignal = context?.signal;
          await new Promise<void>((resolve) => {
            context?.signal?.addEventListener('abort', () => resolve(), { once: true });
          });
          return { ok: false, error: 'tool observed abort' };
        }),
        { id: 'call-1', tool: 'lifecycle_tool', input: {} },
        { signal: controller.signal },
      );

      controller.abort(new Error('host cancelled the run'));

      await expect(execution).resolves.toEqual({
        ok: false,
        error: 'host cancelled the run',
      });
      expect(toolSignal?.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('aborts the tool when its execution timeout elapses', async () => {
    vi.useFakeTimers();
    let toolSignal: AbortSignal | undefined;

    try {
      const execution = ToolExecutionService.execute(
        registry(async (_input, context) => {
          toolSignal = context?.signal;
          await new Promise<void>((resolve) => {
            context?.signal?.addEventListener('abort', () => resolve(), { once: true });
          });
          return { ok: false, error: 'tool observed timeout' };
        }),
        { id: 'call-1', tool: 'lifecycle_tool', input: {} },
        { timeoutMs: 100 },
      );

      await vi.advanceTimersByTimeAsync(100);

      await expect(execution).resolves.toEqual({
        ok: false,
        error: 'Tool "lifecycle_tool" timed out after 100ms',
      });
      expect(toolSignal?.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
