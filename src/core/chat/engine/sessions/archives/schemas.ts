import { z } from 'zod';

export const ChatArchiveRecordSchema = z.object({
  id: z.string().min(1).describe('Stable identifier for this conversation archive.'),
  path: z.string().min(1).describe('Repository-owned locator for the exact archived conversation history.'),
  summaryPath: z.string().min(1).describe('Repository-owned locator for the rolling archive summary.'),
  shortDescription: z.string()
    .describe('Short human-readable description of the archived conversation slice.')
    .optional(),
  messageCount: z.number().int().nonnegative().describe('Number of messages stored in this archive.'),
  createdAt: z.string().describe('Timestamp when this archive was created.'),
  summaryModel: z.string()
    .describe('Model used to generate the archive summary, when available.')
    .optional(),
});

export const ChatArchiveManifestSchema = z.object({
  version: z.literal(1).describe('Conversation archive manifest schema version.'),
  sessionId: z.string().min(1).describe('Session whose compacted history this manifest indexes.'),
  currentSummaryPath: z.string().min(1)
    .describe('Repository-owned locator for the current cumulative summary.')
    .optional(),
  archives: z.array(ChatArchiveRecordSchema).describe('Archives in append order.'),
}).strict();
