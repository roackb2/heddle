import { z } from 'zod';

export const StartHostedAgentRunInputSchema = z.object({
  sessionId: z.string().trim().min(1).max(128),
  prompt: z.string().trim().min(1).max(20_000),
});

export const StartHostedAgentRunResultSchema = z.object({
  accepted: z.literal(true),
  runId: z.string().min(1),
  acceptedAt: z.iso.datetime(),
  sessionId: z.string().min(1),
});

const RunEventEnvelopeSchema = z.object({
  runId: z.string().min(1),
  sequence: z.number().int().positive().safe(),
  timestamp: z.iso.datetime(),
});

export const HostedAgentRunEventSchema = z.discriminatedUnion('kind', [
  RunEventEnvelopeSchema.extend({
    kind: z.literal('activity'),
    activity: z.object({
      type: z.string().min(1),
    }).passthrough(),
  }),
  RunEventEnvelopeSchema.extend({
    kind: z.literal('result'),
    result: z.object({
      outcome: z.string().min(1),
      summary: z.string(),
    }),
  }),
  RunEventEnvelopeSchema.extend({
    kind: z.literal('cancelled'),
    reason: z.string(),
  }),
  RunEventEnvelopeSchema.extend({
    kind: z.literal('error'),
    error: z.object({
      code: z.literal('run_failed'),
      message: z.string(),
    }),
  }),
]);

export const CancelHostedAgentRunResultSchema = z.object({
  cancelled: z.boolean(),
});

export const HostedAgentApiErrorSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
  }),
});

export type StartHostedAgentRunInput = z.infer<typeof StartHostedAgentRunInputSchema>;
export type StartHostedAgentRunResult = z.infer<typeof StartHostedAgentRunResultSchema>;
export type HostedAgentRunEvent = z.infer<typeof HostedAgentRunEventSchema>;
export type CancelHostedAgentRunResult = z.infer<typeof CancelHostedAgentRunResultSchema>;
