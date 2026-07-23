import { ToolExecutionService, ToolRegistry } from '@/core/tools/index.js';

const registry = new ToolRegistry([{
  name: 'fast_tool',
  description: 'Completes immediately.',
  parameters: { type: 'object', properties: {} },
  execute: async () => ({ ok: true }),
}]);

const result = await ToolExecutionService.execute(
  registry,
  { id: 'call-1', tool: 'fast_tool', input: {} },
);

if (!result.ok) {
  throw new Error(result.error ?? 'Fast tool failed.');
}
