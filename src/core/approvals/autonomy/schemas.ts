import { z } from 'zod';

export const AutopilotRootAccessSchema = z.enum(['read', 'write', 'autopilot', 'manual-only', 'deny']);

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
  path: z.string().min(1),
  access: AutopilotRootAccessSchema,
  allow: z.array(AutopilotCapabilitySchema).optional(),
}).strip();

export const AutopilotProfileSchema = z.object({
  mode: z.enum(['interactive', 'autopilot']),
  roots: z.array(AutopilotRootPolicySchema),
  environments: z.object({
    allow: z.array(z.enum(['local', 'dev'])),
    requireApproval: z.array(z.enum(['staging', 'production', 'unknown'])),
  }).strip(),
}).strip();
