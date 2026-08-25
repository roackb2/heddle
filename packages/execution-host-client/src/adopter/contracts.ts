import { z } from 'zod';
import { ExecutionHostConversationTurnRequestSchema } from '../contracts/index.js';

export const DEFAULT_ADOPTER_JWKS_PATH = '/.well-known/jwks.json';
export const DEFAULT_ADOPTER_CONVERSATION_TURNS_PATH =
  '/hosted-execution/conversation-turns';

export const HostedConversationRequestSchema = z.object({
  prompt: ExecutionHostConversationTurnRequestSchema.shape.prompt,
}).strict();

export const HostedConversationPublicErrorSchema = z.object({
  error: z.object({
    message: z.string().min(1).max(1_600),
  }).strict(),
}).strict();

export type HostedConversationRequest = z.infer<
  typeof HostedConversationRequestSchema
>;
