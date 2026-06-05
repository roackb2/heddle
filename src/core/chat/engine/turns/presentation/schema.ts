import { z } from 'zod';

const TurnPresentationBaseTimelineItemSchema = z.object({
  id: z.string(),
  toolCallId: z.string(),
  step: z.number().optional(),
  timestamp: z.string(),
});

const TurnApprovalTimelineItemSchema = TurnPresentationBaseTimelineItemSchema.extend({
  type: z.literal('approval'),
  tool: z.string(),
  summary: z.string(),
  status: z.enum(['requested', 'approved', 'denied']),
  command: z.string().optional(),
  reason: z.string().optional(),
});

const TurnEditDiffTimelineItemSchema = TurnPresentationBaseTimelineItemSchema.extend({
  type: z.literal('edit_diff'),
  path: z.string(),
  action: z.string().optional(),
  patch: z.string(),
  truncated: z.boolean(),
});

export const ConversationTurnPresentationTimelineItemSchema = z.union([
  TurnApprovalTimelineItemSchema,
  TurnEditDiffTimelineItemSchema,
]);

export const ConversationTurnPresentationSchema = z.object({
  timelineItems: z.array(ConversationTurnPresentationTimelineItemSchema),
});
