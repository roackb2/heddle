import { z } from 'zod';

export const AutopilotRootAccessSchema = z.enum(['read', 'write', 'autopilot', 'manual-only', 'deny']);

export const AutopilotProfilePresetSchema = z.enum(['auto', 'custom']);

export const AutopilotRootSourceSchema = z.enum([
  'generated-working-root',
  'user-trusted-repo',
  'custom-config',
  'safety-default',
]);

export const AutopilotCapabilitySchema = z.enum([
  'read',
  'write',
  'execute',
  'simple-delete',
  'many-file-edit',
  'verification',
  'formatting',
  'dependency',
  'git-stage',
]);

export const AutopilotRootPolicySchema = z.object({
  path: z.string().min(1)
    .describe('Filesystem root covered by this policy. Usually a git/project root, relative to the active workspace root unless absolute.'),
  access: AutopilotRootAccessSchema
    .describe('How autonomy treats this root before tool execution. Deny and manual-only roots override unattended Auto behavior.'),
  allow: z.array(AutopilotCapabilitySchema).optional()
    .describe('Capabilities allowed when access is write or autopilot. Read-only/manual/deny roots ignore this list.'),
  source: AutopilotRootSourceSchema.optional()
    .describe('Where the root came from: generated Auto defaults, user-approved repo expansion, custom config, or safety defaults.'),
}).strip();

export const AutopilotProfileSchema = z.object({
  mode: z.enum(['interactive', 'autopilot'])
    .describe('Whether the profile only requests approvals or can allow matching tool calls without routine approval.'),
  preset: AutopilotProfilePresetSchema.optional()
    .describe('Product preset that produced this profile. Auto remains Auto even when user-approved roots are added.'),
  roots: z.array(AutopilotRootPolicySchema)
    .describe('Ordered root policies. The evaluator uses the most specific matching normalized root.'),
  environments: z.object({
    allow: z.array(z.enum(['local', 'dev']))
      .describe('Environments eligible for unattended execution when the agent-declared envelope matches policy.'),
    requireApproval: z.array(z.enum(['staging', 'production', 'unknown']))
      .describe('Environments that must request approval even when root and capability checks pass.'),
  }).strip(),
}).strip();
