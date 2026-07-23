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

    expect(execute).toHaveBeenCalledWith(
      { path: 'README.md' },
      { signal: expect.any(AbortSignal) },
    );
  });

  it('accepts an envelope with empty targetRoots for non-mutating tools', async () => {
    const execute = vi.fn(async () => ({ ok: true, output: 'ok' }));
    const registry = new ToolRegistry([tool({ execute })]);

    await expect(ToolExecutionService.execute(registry, {
      id: 'call-1',
      tool: 'test_tool',
      input: {
        path: 'README.md',
        policy: {
          operations: ['read'],
          intent: 'update the active plan',
          targetRoots: [],
          expectedEffects: ['record plan progress'],
          environment: 'local',
          confidence: 'high',
        },
      },
    })).resolves.toEqual({ ok: true, output: 'ok' });

    expect(execute).toHaveBeenCalledWith(
      { path: 'README.md' },
      { signal: expect.any(AbortSignal) },
    );
  });

  it('does not treat network transport as a filesystem mutation requiring roots', async () => {
    const execute = vi.fn(async () => ({ ok: true, output: 'ok' }));
    const registry = new ToolRegistry([tool({ execute })]);

    await expect(ToolExecutionService.execute(registry, {
      id: 'call-1',
      tool: 'test_tool',
      input: {
        path: 'remote-document',
        policy: {
          operations: ['read', 'network'],
          intent: 'read a document through an HTTP MCP transport',
          targetRoots: [],
          expectedEffects: ['read remote document'],
          maxDestructiveScope: 'none',
          environment: 'production',
          confidence: 'high',
        },
      },
    })).resolves.toEqual({ ok: true, output: 'ok' });

    expect(execute).toHaveBeenCalledWith({ path: 'remote-document' });
  });

  it('rejects an envelope with empty roots for mutating operations', async () => {
    const execute = vi.fn(async () => ({ ok: true }));
    const registry = new ToolRegistry([tool({ execute })]);

    await expect(ToolExecutionService.execute(registry, {
      id: 'call-1',
      tool: 'test_tool',
      input: {
        path: 'README.md',
        policy: {
          operations: ['execute'],
          intent: 'run a build command',
          targetRoots: [],
          expectedEffects: ['run build'],
          environment: 'local',
          confidence: 'high',
        },
      },
    })).resolves.toEqual(expect.objectContaining({
      ok: false,
      error: expect.stringContaining('must declare at least one target or write root'),
    }));

    expect(execute).not.toHaveBeenCalled();
  });

  it('accepts a mutating envelope when writeRoots are declared without targetRoots', async () => {
    const execute = vi.fn(async () => ({ ok: true, output: 'ok' }));
    const registry = new ToolRegistry([tool({ execute })]);

    await expect(ToolExecutionService.execute(registry, {
      id: 'call-1',
      tool: 'test_tool',
      input: {
        path: 'README.md',
        policy: {
          operations: ['write'],
          intent: 'edit a file',
          targetRoots: [],
          writeRoots: ['.'],
          expectedEffects: ['edit README'],
          environment: 'local',
          confidence: 'high',
        },
      },
    })).resolves.toEqual({ ok: true, output: 'ok' });

    expect(execute).toHaveBeenCalledWith(
      { path: 'README.md' },
      { signal: expect.any(AbortSignal) },
    );
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

  it('rejects model attempts to add host-owned authority fields before execution', async () => {
    const execute = vi.fn(async () => ({ ok: true }));
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
          authority: {
            serverId: 'spoofed-server',
          },
        },
      },
    })).resolves.toEqual(expect.objectContaining({
      ok: false,
      error: expect.stringContaining('authority, transport, target environment, and tenant provenance are host-owned'),
    }));

    expect(execute).not.toHaveBeenCalled();
  });
});
