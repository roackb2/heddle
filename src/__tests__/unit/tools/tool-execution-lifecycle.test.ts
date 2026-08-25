import { describe, expect, it, vi } from 'vitest';
import { ToolExecutionService, ToolRegistry } from '@/core/tools/index.js';
import type { ToolDefinition } from '@/core/types.js';

function registry(
  execute: ToolDefinition['execute'],
  timeoutMs?: number | null,
): ToolRegistry {
  return new ToolRegistry([{
    name: 'lifecycle_tool',
    description: 'Exercise tool lifecycle behavior.',
    timeoutMs,
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

  it('uses the 30-second default when neither the tool nor caller specifies a timeout', async () => {
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
      );

      await vi.advanceTimersByTimeAsync(29_999);
      expect(toolSignal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);

      await expect(execution).resolves.toEqual({
        ok: false,
        error: 'Tool "lifecycle_tool" timed out after 30000ms',
      });
      expect(toolSignal?.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses a tool-owned timeout when the caller does not override it', async () => {
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
        }, 125),
        { id: 'call-1', tool: 'lifecycle_tool', input: {} },
      );

      await vi.advanceTimersByTimeAsync(125);

      await expect(execution).resolves.toEqual({
        ok: false,
        error: 'Tool "lifecycle_tool" timed out after 125ms',
      });
      expect(toolSignal?.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('lets an explicit execution timeout override the tool-owned timeout', async () => {
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
        }, 25),
        { id: 'call-1', tool: 'lifecycle_tool', input: {} },
        { timeoutMs: 100 },
      );

      await vi.advanceTimersByTimeAsync(25);
      expect(toolSignal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(75);

      await expect(execution).resolves.toEqual({
        ok: false,
        error: 'Tool "lifecycle_tool" timed out after 100ms',
      });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('disables only the wrapper timer while preserving host cancellation', async () => {
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
        }, null),
        { id: 'call-1', tool: 'lifecycle_tool', input: {} },
        { signal: controller.signal },
      );

      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(toolSignal?.aborted).toBe(false);

      controller.abort(new Error('host cancelled long-running tool'));

      await expect(execution).resolves.toEqual({
        ok: false,
        error: 'host cancelled long-running tool',
      });
      expect(toolSignal?.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid tool-owned timeout %s',
    async (timeoutMs) => {
      await expect(ToolExecutionService.execute(
        registry(async () => ({ ok: true }), timeoutMs),
        { id: 'call-1', tool: 'lifecycle_tool', input: {} },
      )).resolves.toEqual({
        ok: false,
        error: 'Tool "lifecycle_tool" timeoutMs must be null or a positive finite number',
      });
    },
  );

  it.each([0, Number.POSITIVE_INFINITY])(
    'rejects invalid caller timeout override %s',
    async (timeoutMs) => {
      await expect(ToolExecutionService.execute(
        registry(async () => ({ ok: true }), 125),
        { id: 'call-1', tool: 'lifecycle_tool', input: {} },
        { timeoutMs },
      )).resolves.toEqual({
        ok: false,
        error: 'Tool "lifecycle_tool" timeoutMs must be null or a positive finite number',
      });
    },
  );
});
