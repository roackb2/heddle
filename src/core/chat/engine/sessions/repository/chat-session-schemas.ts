/**
 * Zod schemas for the current chat session persistence format.
 *
 * Keep field descriptions human-friendly because this file is the canonical
 * contract for catalog and per-session JSON on disk.
 */
import { z } from 'zod';
import { ConversationDirectShellLineResultSchema } from '@/core/chat/engine/direct-shell/result-schema.js';
import { ChatArchiveRecordSchema } from '@/core/chat/engine/sessions/archives/schemas.js';
import { ConversationTurnPresentationSchema } from '@/core/chat/engine/turns/presentation/index.js';
import { CustomAgentExecutionSnapshotSchema } from '@/core/custom-agents/index.js';
import { LlmUsageSchema } from '@/core/llm/usage/index.js';
import { REASONING_EFFORTS } from '@/core/llm/types.js';

const ReasoningEffortSchema = z.enum(REASONING_EFFORTS);
const ChatSessionRetentionSchema = z.enum(['reusable', 'one_off']);
const ChatSessionLeaseOwnerSchema = z.enum(['tui', 'daemon', 'ask']);
const CompactionStatusSchema = z.enum(['idle', 'running', 'failed']);

const ToolCallSchema = z.object({
  id: z.string().describe('Provider-assigned tool call identifier used to pair tool results with assistant requests.'),
  tool: z.string().describe('Registered Heddle tool name requested by the assistant.'),
  input: z.unknown().describe('Raw structured input passed to the requested tool.'),
});

const AssistantProviderContinuationSchema = z.discriminatedUnion('provider', [
  z.object({
    provider: z.literal('kimi'),
    reasoningContent: z.string().describe(
      'Provider-private Kimi continuation replayed to Kimi for preserved thinking. It is not user-facing reasoning narration.',
    ),
  }),
]);

const ChatMessageSchema = z.union([
  z.object({
    role: z.literal('system').describe('Transcript role for host-provided system instructions.'),
    content: z.string().describe('System message text sent to the model.'),
  }),
  z.object({
    role: z.literal('user').describe('Transcript role for user prompts.'),
    content: z.string().describe('User prompt text sent to the model.'),
  }),
  z.object({
    role: z.literal('assistant').describe('Transcript role for assistant responses.'),
    content: z.string().describe('Assistant text content returned by the model.'),
    toolCalls: z.array(ToolCallSchema)
      .describe('Tool calls requested by this assistant message.')
      .optional(),
    providerContinuation: AssistantProviderContinuationSchema
      .describe('Provider-private assistant state retained only for durable model transcript replay.')
      .optional(),
  }),
  z.object({
    role: z.literal('tool').describe('Transcript role for tool execution results.'),
    content: z.string().describe('Serialized tool result content returned to the model.'),
    toolCallId: z.string().describe('Identifier of the assistant tool call this result answers.'),
  }),
]);

const ChatMessagesSchema = z.array(z.unknown())
  .transform((messages) => messages.flatMap((message) => {
    const parsed = ChatMessageSchema.safeParse(message);
    return parsed.success ? [parsed.data] : [];
  }));

export const ConversationLineSchema = z.object({
  id: z.string().describe('Stable visible message identifier used by chat surfaces.'),
  role: z.enum(['user', 'assistant']).describe('Visible chat role rendered in host interfaces.'),
  text: z.string().describe('Human-facing message text shown in chat history.'),
  isStreaming: z.boolean()
    .describe('Whether this visible line was still streaming when captured.')
    .optional(),
  isPending: z.boolean()
    .describe('Whether this visible line represents an accepted but unfinished user/assistant update.')
    .optional(),
  directShellResult: ConversationDirectShellLineResultSchema.optional(),
});

const ConversationLinesSchema = z.array(z.unknown())
  .transform((messages) => messages.flatMap((message) => {
    const parsed = ConversationLineSchema.safeParse(message);
    return parsed.success ? [parsed.data] : [];
  }));

const ChatTurnAgentSchema = z.object({
  id: z.string().describe('Custom agent id used for this turn.'),
  name: z.string().describe('Custom agent display name used for this turn.'),
  modeAlias: z.enum(['ask', 'code', 'review'])
    .describe('Built-in mode alias for this custom agent, when present.')
    .optional(),
  source: z.enum(['project', 'user', 'built-in'])
    .describe('Definition source for the custom agent used for this turn.'),
  definitionHash: z.string().describe('Hash of the custom-agent definition snapshot used for this turn.'),
});

const TurnSummarySchema = z.object({
  id: z.string().describe('Stable identifier for this completed turn summary.'),
  prompt: z.string().describe('User prompt that started the turn.'),
  outcome: z.string().describe('Final stop reason or outcome reported by the agent loop.'),
  summary: z.string().describe('Short human-readable turn summary.'),
  steps: z.number().describe('Number of assistant loop steps executed in the turn.'),
  traceFile: z.string().describe('Path to the persisted trace file for this turn.'),
  events: z.array(z.string()).describe('Compact event summaries extracted from the turn trace.'),
  presentation: ConversationTurnPresentationSchema
    .describe('Compact non-transcript tool activity metadata for conversation timeline presentation.')
    .optional(),
  agent: ChatTurnAgentSchema
    .describe('Compact custom-agent metadata for this completed turn.')
    .optional(),
  agentSnapshot: CustomAgentExecutionSnapshotSchema
    .describe('Resolved custom-agent execution snapshot used by this completed turn.')
    .optional(),
});

const TurnSummaryReadSchema = TurnSummarySchema.extend({
  presentation: ConversationTurnPresentationSchema.optional().catch(undefined),
  agent: ChatTurnAgentSchema.optional().catch(undefined),
  agentSnapshot: CustomAgentExecutionSnapshotSchema.optional().catch(undefined),
});

const TurnSummariesSchema = z.array(z.unknown())
  .transform((turns) => turns.flatMap((turn) => {
    const parsed = TurnSummaryReadSchema.safeParse(turn);
    return parsed.success ? [parsed.data] : [];
  }));

const ChatContextStatsSchema = z.object({
  estimatedHistoryTokens: z.number().describe('Estimated token count for the session history currently retained in context.'),
  request: z.object({
    estimatedTokens: z.number()
      .describe('Estimated token count for the most recent turn request.')
      .optional(),
    toolNames: z.array(z.string())
      .describe('Tool names available to the most recent turn request.')
      .optional(),
    goal: z.string()
      .describe('Most recent user goal or prompt associated with these context stats.')
      .optional(),
    usage: LlmUsageSchema
      .describe('Provider usage reported by the most recent turn request.')
      .optional(),
  }).describe('Most recent request-level context and usage metadata.').optional(),
  compaction: z.object({
    compactedMessages: z.number()
      .describe('Number of transcript messages replaced by the latest compaction summary.')
      .optional(),
    compactedAt: z.string()
      .describe('Timestamp when the latest compaction completed.')
      .optional(),
    status: CompactionStatusSchema
      .describe('Current or latest compaction lifecycle status.')
      .optional(),
    error: z.string()
      .describe('Last compaction error message, when compaction failed.')
      .optional(),
  }).describe('Session compaction lifecycle metadata.').optional(),
  archive: z.object({
    count: z.number()
      .describe('Number of archive records currently associated with the session.')
      .optional(),
    currentSummaryPath: z.string()
      .describe('Repository-owned locator for the active compacted summary used for context reconstruction.')
      .optional(),
    lastArchivePath: z.string()
      .describe('Repository-owned locator for the most recently written conversation archive.')
      .optional(),
  }).describe('Archive metadata used to reconnect compacted history with durable repository content.').optional(),
});

const ChatArchiveRecordsSchema = z.array(z.unknown())
  .transform((archives) => archives.flatMap((archive) => {
    const parsed = ChatArchiveRecordSchema.safeParse(archive);
    return parsed.success ? [parsed.data] : [];
  }));

const ChatSessionLeaseSchema = z.object({
  ownerKind: ChatSessionLeaseOwnerSchema.describe('Kind of host currently holding the session lease.'),
  hostId: z.string()
    .describe('Host or replica identity for the current lease holder.')
    .optional(),
  ownerId: z.string().describe('Unique owner identifier for the current lease holder.'),
  fencingToken: z.number()
    .int()
    .nonnegative()
    .describe('Monotonic token that fences stale lease holders.')
    .default(0),
  acquiredAt: z.string().describe('Timestamp when the current lease was acquired.'),
  lastSeenAt: z.string().describe('Timestamp when the lease holder last refreshed ownership.'),
  clientLabel: z.string()
    .describe('Optional human-facing label for the lease holder.')
    .optional(),
});

const QueuedConversationPromptSchema = z.object({
  id: z.string().describe('Stable identifier for this queued prompt.'),
  prompt: z.string().describe('User prompt waiting for the current or earlier run to finish.'),
  agentProfileId: z.string()
    .describe('Custom agent id selected when this prompt entered the queue.')
    .optional(),
  agentSnapshot: CustomAgentExecutionSnapshotSchema
    .describe('Resolved custom-agent execution snapshot selected when this prompt entered the queue.')
    .optional(),
  systemContext: z.string()
    .describe('Optional runtime context that should be applied when this queued prompt runs.')
    .optional(),
  createdAt: z.string().describe('Timestamp when this prompt entered the session queue.'),
  updatedAt: z.string().describe('Timestamp when this queued prompt was last edited.'),
});

const QueuedConversationPromptReadSchema = QueuedConversationPromptSchema.extend({
  agentSnapshot: CustomAgentExecutionSnapshotSchema.optional().catch(undefined),
});

const QueuedConversationPromptsSchema = z.array(z.unknown())
  .transform((prompts) => prompts.flatMap((prompt) => {
    const parsed = QueuedConversationPromptReadSchema.safeParse(prompt);
    return parsed.success ? [parsed.data] : [];
  }));

export const CatalogEntryReadSchema = z.object({
  id: z.string().describe('Stable session identifier used by all host surfaces.'),
  revision: z.number()
    .int()
    .positive()
    .describe('Monotonic revision used for optimistic concurrency.')
    .optional()
    .catch(1),
  name: z.string().describe('Human-facing session title shown in session lists.'),
  retention: ChatSessionRetentionSchema
    .describe('Whether the session is reusable or intended as a one-off ask session.')
    .optional()
    .catch(undefined),
  workspaceId: z.string()
    .describe('Workspace identifier this session belongs to, when known.')
    .optional(),
  pinned: z.boolean()
    .describe('Whether this session should be grouped above unpinned sessions in session lists.')
    .optional()
    .catch(false),
  archivedAt: z.string()
    .describe('Timestamp when this session was archived and hidden from normal session lists.')
    .optional(),
  createdAt: z.string()
    .describe('Timestamp when the session was created.')
    .optional(),
  updatedAt: z.string()
    .describe('Timestamp when the session was last changed.')
    .optional(),
  model: z.string()
    .describe('Default model selected for future turns in this session.')
    .optional(),
  reasoningEffort: ReasoningEffortSchema
    .describe('Default reasoning effort selected for future turns in this session.')
    .optional()
    .catch(undefined),
  driftEnabled: z.boolean()
    .describe('Whether semantic drift awareness is enabled for this session.')
    .optional()
    .catch(false),
  lastContinuePrompt: z.string()
    .describe('Most recent continue prompt recorded for follow-up turn ergonomics.')
    .optional(),
  context: ChatContextStatsSchema
    .describe('Current context, compaction, and archive metadata for this session.')
    .optional()
    .catch(undefined),
  archives: ChatArchiveRecordsSchema
    .describe('Conversation archives associated with this session.')
    .optional()
    .catch(undefined),
  leaseEpoch: z.number()
    .int()
    .nonnegative()
    .describe('Last fencing token issued for this session.')
    .optional()
    .catch(0),
  lease: ChatSessionLeaseSchema
    .describe('Current session lease held by a TUI, daemon, or ask host.')
    .optional()
    .catch(undefined),
});

export const CatalogEntryWriteSchema = CatalogEntryReadSchema.extend({
  revision: z.number()
    .int()
    .positive()
    .describe('Monotonic revision used for optimistic concurrency.'),
  pinned: z.boolean()
    .describe('Whether this session should be grouped above unpinned sessions in session lists.'),
  createdAt: z.string().describe('Timestamp when the session was created.'),
  updatedAt: z.string().describe('Timestamp when the session was last changed.'),
});

export const CatalogReadSchema = z.object({
  version: z.literal(1).describe('Persisted catalog schema version.'),
  sessions: z.array(z.unknown()).describe('Session metadata entries; invalid entries are skipped during reads.'),
});

export const CatalogWriteSchema = z.object({
  version: z.literal(1).describe('Persisted catalog schema version.'),
  sessions: z.array(CatalogEntryWriteSchema).describe('Session metadata entries written to the catalog file.'),
});

export const SessionBodyReadSchema = z.object({
  id: z.string()
    .describe('Session identifier duplicated in the body for human inspection.')
    .optional(),
  retention: ChatSessionRetentionSchema
    .describe('Whether the session is reusable or intended as a one-off ask session.')
    .optional()
    .catch(undefined),
  workspaceId: z.string()
    .describe('Workspace identifier duplicated in the body for human inspection.')
    .optional(),
  pinned: z.boolean()
    .describe('Whether this session should be grouped above unpinned sessions in session lists.')
    .optional()
    .catch(false),
  archivedAt: z.string()
    .describe('Timestamp when this session was archived and hidden from normal session lists.')
    .optional(),
  history: ChatMessagesSchema
    .describe('Model-facing transcript retained for future turns.')
    .optional()
    .catch([]),
  messages: ConversationLinesSchema
    .describe('Host-facing visible conversation lines.')
    .optional()
    .catch([]),
  turns: TurnSummariesSchema
    .describe('Recent completed turn summaries shown in session detail surfaces.')
    .optional()
    .catch([]),
  archives: ChatArchiveRecordsSchema
    .describe('Conversation archives duplicated in the body for session reconstruction.')
    .optional()
    .catch(undefined),
  leaseEpoch: z.number()
    .int()
    .nonnegative()
    .describe('Last fencing token issued for this session.')
    .optional()
    .catch(0),
  lease: ChatSessionLeaseSchema
    .describe('Current session lease duplicated in the body for session reconstruction.')
    .optional()
    .catch(undefined),
  queuedPrompts: QueuedConversationPromptsSchema
    .describe('FIFO user prompts accepted while the session has earlier work to finish.')
    .optional()
    .catch([]),
});

export const SessionBodyWriteSchema = z.object({
  id: z.string().describe('Session identifier duplicated in the body for human inspection.'),
  retention: ChatSessionRetentionSchema
    .describe('Whether the session is reusable or intended as a one-off ask session.')
    .optional(),
  workspaceId: z.string()
    .describe('Workspace identifier duplicated in the body for human inspection.')
    .optional(),
  pinned: z.boolean()
    .describe('Whether this session should be grouped above unpinned sessions in session lists.')
    .default(false),
  archivedAt: z.string()
    .describe('Timestamp when this session was archived and hidden from normal session lists.')
    .optional(),
  history: z.array(ChatMessageSchema).describe('Model-facing transcript retained for future turns.'),
  messages: z.array(ConversationLineSchema).describe('Host-facing visible conversation lines.'),
  turns: z.array(TurnSummarySchema).describe('Recent completed turn summaries shown in session detail surfaces.'),
  archives: z.array(ChatArchiveRecordSchema)
    .describe('Conversation archives duplicated in the body for session reconstruction.')
    .optional(),
  leaseEpoch: z.number()
    .int()
    .nonnegative()
    .describe('Last fencing token issued for this session.')
    .optional(),
  lease: ChatSessionLeaseSchema
    .describe('Current session lease duplicated in the body for session reconstruction.')
    .optional(),
  queuedPrompts: z.array(QueuedConversationPromptSchema)
    .describe('FIFO user prompts accepted while the session has earlier work to finish.')
    .default([]),
});

/**
 * Strict database-neutral shape for a complete opaque Heddle session record.
 *
 * Legacy file reads intentionally use the tolerant read schemas above. Remote
 * adapters should use this schema through `ChatSessionPersistenceCodec` so a
 * malformed database record fails loudly instead of silently losing history.
 */
export const ChatSessionRecordSchema = CatalogEntryWriteSchema
  .omit({ revision: true })
  .extend({
    retention: ChatSessionRetentionSchema.optional(),
    pinned: z.boolean(),
    reasoningEffort: ReasoningEffortSchema.optional(),
    driftEnabled: z.boolean().optional(),
    context: ChatContextStatsSchema.optional(),
    archives: z.array(ChatArchiveRecordSchema).optional(),
    leaseEpoch: z.number().int().nonnegative().optional(),
    lease: ChatSessionLeaseSchema.optional(),
    history: z.array(ChatMessageSchema),
    messages: z.array(ConversationLineSchema),
    turns: z.array(TurnSummarySchema),
    queuedPrompts: z.array(QueuedConversationPromptSchema),
  })
  .strict();

export type CatalogEntryRead = z.infer<typeof CatalogEntryReadSchema>;
export type ConversationLineValue = z.infer<typeof ConversationLineSchema>;
