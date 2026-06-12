import { z } from 'zod';

export const CustomAgentModeAliasSchema = z.enum(['ask', 'code', 'review']);
export const CustomAgentSourceKindSchema = z.enum(['project', 'user', 'built-in']);
export const CustomAgentToolPresetSchema = z.enum(['default', 'inspect', 'none', 'custom']);
export const CustomAgentApprovalPresetSchema = z.enum(['interactive', 'read_only', 'auto', 'custom']);
export const CustomAgentReasoningEffortSchema = z.enum(['low', 'medium', 'high', 'ultrahigh']);
export const CustomAgentMemoryModeSchema = z.enum(['none', 'read-and-record', 'maintainer', 'legacy-full']);
export const ToolCapabilitySchema = z.enum([
  'workspace.read',
  'workspace.write',
  'shell.inspect',
  'shell.mutate',
  'memory.read',
  'memory.write',
  'external.read',
  'browser.read',
  'browser.action',
  'mcp.unknown',
  'internal.state',
]);

export const RuntimeToolSelectionProfileSchema = z.object({
  preset: CustomAgentToolPresetSchema.default('default'),
  includeTools: z.array(z.string().min(1)).optional(),
  excludeTools: z.array(z.string().min(1)).optional(),
  allowedCapabilities: z.array(ToolCapabilitySchema).optional(),
  deniedCapabilities: z.array(ToolCapabilitySchema).optional(),
  memoryMode: CustomAgentMemoryModeSchema.optional(),
});

export const ToolApprovalProfileSchema = z.object({
  preset: CustomAgentApprovalPresetSchema.default('interactive'),
});

export const CustomAgentFrontmatterSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  id: z.string().min(1).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
  name: z.string().min(1),
  description: z.string().min(1),
  modeAlias: CustomAgentModeAliasSchema.optional(),
  runtime: z.object({
    maxSteps: z.number().int().min(1).max(500).optional(),
    model: z.string().min(1).optional(),
    reasoningEffort: CustomAgentReasoningEffortSchema.optional(),
  }).default({}),
  tools: RuntimeToolSelectionProfileSchema.default({ preset: 'default' }),
  approval: ToolApprovalProfileSchema.default({ preset: 'interactive' }),
});

export const CustomAgentExecutionSnapshotSchema = z.object({
  agentProfileId: z.string().min(1),
  agentName: z.string().min(1),
  modeAlias: CustomAgentModeAliasSchema.optional(),
  source: CustomAgentSourceKindSchema,
  definitionHash: z.string().min(1),
  runtime: CustomAgentFrontmatterSchema.shape.runtime,
  toolProfile: RuntimeToolSelectionProfileSchema,
  approvalProfile: ToolApprovalProfileSchema,
  systemContextAppendix: z.string(),
});
