/**
 * Stage 05.2 public HTTP/SSE contract.
 *
 * Zod schemas live at the untrusted wire boundary, not in the stage-1 service.
 * Extend these schemas only with product data safe for remote clients.
 */
import { z } from 'zod';
import {
  ConversationRunProtocolCodec,
  type ConversationRunProtocolEvent,
} from '../../../../src/remote.js';

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

const HostedAgentActivitySchema = z.object({
  type: z.string().min(1),
}).passthrough();

const HostedAgentResultSchema = z.object({
  outcome: z.string().min(1),
  summary: z.string(),
});

export const HostedAgentRunProtocol = new ConversationRunProtocolCodec({
  activity: HostedAgentActivitySchema,
  result: HostedAgentResultSchema,
});

export const HostedAgentRunEventSchema = HostedAgentRunProtocol.eventSchema;

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
export type HostedAgentRunEvent = ConversationRunProtocolEvent<
  z.infer<typeof HostedAgentActivitySchema>,
  z.infer<typeof HostedAgentResultSchema>
>;
export type CancelHostedAgentRunResult = z.infer<typeof CancelHostedAgentRunResultSchema>;
