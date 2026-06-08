import { describe, expect, it, vi } from 'vitest';
import { ToolExecutionService, ToolPolicyEnvelopeSchemaService, ToolRegistry } from '@/core/tools/index.js';
import type { ToolDefinition } from '@/core/types.js';

function tool(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    name: 'test_tool',
    description: 'test tool',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: { type: 'string' },
      },
      required: ['path'],
    },
    execute: async () => ({ ok: true }),
    ...overrides,
  };
}

describe('tool policy envelope', () => {
  it('adds optional policy to object-shaped tool schemas', () => {
    const parameters = ToolPolicyEnvelopeSchemaService.addToParameters(tool().parameters);

    expect(parameters).toEqual(expect.objectContaining({
      properties: expect.objectContaining({
        path: { type: 'string' },
        policy: expect.objectContaining({
          type: 'object',
          required: ['operations', 'intent', 'targetRoots', 'expectedEffects', 'environment', 'confidence'],
        }),
      }),
      required: ['path'],
    }));
  });

  it('leaves non-object schemas and existing policy fields unchanged', () => {
    const nonObject = { type: 'string' };
    expect(ToolPolicyEnvelopeSchemaService.addToParameters(nonObject)).toBe(nonObject);

    const withPolicy = {
      type: 'object',
      properties: {
        policy: { type: 'string' },
      },
    };
    expect(ToolPolicyEnvelopeSchemaService.addToParameters(withPolicy)).toBe(withPolicy);
  });

  it('keeps executable tools raw while listing model-visible augmented tools', () => {
    const executable = tool();
    const registry = new ToolRegistry([executable]);

    expect(registry.get('test_tool')).toBe(executable);
    expect(registry.list()[0]?.parameters).toEqual(expect.objectContaining({
      properties: expect.objectContaining({
        policy: expect.any(Object),
      }),
    }));
  });

  it('strips policy envelope before tool execution', async () => {
    const execute = vi.fn(async () => ({ ok: true, output: 'ok' }));
    const registry = new ToolRegistry([tool({ execute })]);

    await expect(ToolExecutionService.execute(registry, {
      id: 'call-1',
      tool: 'test_tool',
      input: {
        path: 'README.md',
        policy: {
          operations: ['read'],
          intent: 'inspect README',
          targetRoots: ['.'],
          expectedEffects: ['read README'],
          environment: 'local',
          confidence: 'high',
        },
      },
    })).resolves.toEqual({ ok: true, output: 'ok' });

    expect(execute).toHaveBeenCalledWith({ path: 'README.md' });
  });

  it('rejects invalid policy envelope before execution', async () => {
    const execute = vi.fn(async () => ({ ok: true }));
    const registry = new ToolRegistry([tool({ execute })]);

    await expect(ToolExecutionService.execute(registry, {
      id: 'call-1',
      tool: 'test_tool',
      input: {
        path: 'README.md',
        policy: { operations: [] },
      },
    })).resolves.toEqual(expect.objectContaining({
      ok: false,
      error: expect.stringContaining('Invalid tool policy envelope'),
    }));

    expect(execute).not.toHaveBeenCalled();
  });
});
