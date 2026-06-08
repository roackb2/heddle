import { z } from 'zod';

const AgentSkillActivationStatusSchema = z.enum(['active', 'disabled']);

const AgentSkillActivationRecordSchema = z.object({
  name: z.string().min(1),
  source: z.enum(['project', 'user', 'built-in']),
  skillFilePath: z.string().min(1),
  status: AgentSkillActivationStatusSchema,
  activatedAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

const AgentSkillActivationStoreSchema = z.object({
  version: z.literal(1),
  skills: z.record(z.string(), AgentSkillActivationRecordSchema),
});

export const AgentSkillSchemas = {
  parseActivationStore(input: unknown) {
    return AgentSkillActivationStoreSchema.parse(input);
  },

  emptyActivationStore() {
    return {
      version: 1,
      skills: {},
    } as const;
  },
};
