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
} from '../../../../src/core/chat/remote/index.js';

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

// The parsed value is the public projection. Zod strips every internal
// activity field that is not explicitly allowlisted here.
const HostedAgentActivitySchema = z.object({
  type: z.string().min(1),
  step: z.number().int().nonnegative().optional(),
  text: z.string().optional(),
  done: z.boolean().optional(),
  tool: z.string().min(1).optional(),
  durationMs: z.number().nonnegative().optional(),
  outcome: z.string().optional(),
});

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

export const HostedAgentConversationSchema = z.object({
  sessionId: z.string().min(1),
  messages: z.array(z.object({
    id: z.string().min(1),
    role: z.enum(['user', 'assistant']),
    text: z.string(),
    isPending: z.boolean().optional(),
    isStreaming: z.boolean().optional(),
  })),
  activeRun: z.object({
    runId: z.string().min(1),
    acceptedAt: z.iso.datetime(),
  }).optional(),
});

export const HostedAgentApiErrorSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
  }),
});

export type StartHostedAgentRunInput = z.infer<typeof StartHostedAgentRunInputSchema>;
export type StartHostedAgentRunResult = z.infer<typeof StartHostedAgentRunResultSchema>;
export type HostedAgentActivity = z.infer<typeof HostedAgentActivitySchema>;
export type HostedAgentResult = z.infer<typeof HostedAgentResultSchema>;
export type HostedAgentConversation = z.infer<typeof HostedAgentConversationSchema>;
export type HostedAgentRunEvent = ConversationRunProtocolEvent<
  HostedAgentActivity,
  HostedAgentResult
>;
export type CancelHostedAgentRunResult = z.infer<typeof CancelHostedAgentRunResultSchema>;
