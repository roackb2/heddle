import { z } from 'zod';

export const ApprovalModeSchema = z.enum(['exact', 'prefix', 'tool'])
  .describe('How the remembered approval matches future tool calls.');

export const ApprovalRuleToolSchema = z.enum(['run_shell_mutate', 'edit_file', 'read_file', 'list_files'])
  .describe('Tool covered by the remembered approval rule.');

export const ProjectApprovalRuleSchema = z.object({
  tool: ApprovalRuleToolSchema,
  mode: ApprovalModeSchema,
  command: z.string().describe('Normalized command, path, or wildcard target covered by the rule.'),
  scope: z.string().describe('Execution or file scope covered by the approval.'),
  capability: z.string().describe('Capability category covered by the approval.'),
  createdAt: z.string().describe('ISO timestamp for when the rule was created.'),
}).describe('Persisted remembered project approval rule.');

export const ProjectApprovalRuleListSchema = z.array(ProjectApprovalRuleSchema)
  .describe('Persisted list of remembered project approval rules.');

export const ProjectApprovalRuleCandidateSchema = z.object({
  tool: z.string().optional().describe('Persisted tool name from current or legacy approval data.'),
  mode: z.string().optional().describe('Persisted match mode from current or legacy approval data.'),
  command: z.string().optional().describe('Persisted command, path, or wildcard target.'),
  scope: z.string().optional().describe('Persisted execution or file scope.'),
  capability: z.string().optional().describe('Persisted capability category.'),
  createdAt: z.string().optional().describe('Persisted creation timestamp.'),
}).passthrough().describe('Tolerant approval-rule candidate used when reading disk data.');
