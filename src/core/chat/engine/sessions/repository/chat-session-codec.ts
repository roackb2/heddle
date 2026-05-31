/**
 * Codec service for current chat session persistence.
 *
 * The schema file owns the JSON contract. This class owns the read/write
 * behavior around that contract: graceful read degradation, strict write
 * validation, catalog projection, and compatibility cleanup for legacy visible
 * welcome messages.
 */
import type { ChatSession } from '@/core/chat/types.js';
import {
  CatalogEntryReadSchema,
  CatalogEntryWriteSchema,
  CatalogReadSchema,
  CatalogWriteSchema,
  SessionBodyReadSchema,
  SessionBodyWriteSchema,
  type CatalogEntryRead,
  type ConversationLineValue,
} from './chat-session-schemas.js';
import type { ChatSessionCatalog, ChatSessionCatalogEntry } from './types.js';

export class ChatSessionCodec {
  static parseCatalog(value: unknown): ChatSessionCatalog | undefined {
    const parsed = CatalogReadSchema.safeParse(value);
    if (!parsed.success) {
      return undefined;
    }

    return {
      version: 1,
      sessions: parsed.data.sessions.flatMap((entry) => ChatSessionCodec.parseCatalogEntry(entry)),
    };
  }

  static parseSessionBody(
    value: unknown,
    args: { entry: ChatSessionCatalogEntry },
  ): ChatSession[] {
    const parsed = SessionBodyReadSchema.safeParse(value);
    if (!parsed.success) {
      return [];
    }

    return [{
      ...parsed.data,
      ...args.entry,
      history: parsed.data.history ?? [],
      messages: ChatSessionCodec.resolveMessages(parsed.data.messages),
      turns: parsed.data.turns ?? [],
      queuedPrompts: parsed.data.queuedPrompts ?? [],
    }];
  }

  static projectCatalogEntry(session: ChatSession): ChatSessionCatalogEntry {
    return CatalogEntryWriteSchema.parse(session);
  }

  static serializeCatalog(catalog: ChatSessionCatalog): string {
    return `${JSON.stringify(CatalogWriteSchema.parse(catalog), null, 2)}\n`;
  }

  static serializeSessionBody(session: ChatSession): string {
    return `${JSON.stringify(SessionBodyWriteSchema.parse(session), null, 2)}\n`;
  }

  private static parseCatalogEntry(value: unknown): ChatSessionCatalogEntry[] {
    const parsed = CatalogEntryReadSchema.safeParse(value);
    return parsed.success ? [ChatSessionCodec.normalizeCatalogEntry(parsed.data)] : [];
  }

  private static normalizeCatalogEntry(value: CatalogEntryRead): ChatSessionCatalogEntry {
    const createdAt = value.createdAt ?? new Date().toISOString();
    return {
      retention: undefined,
      workspaceId: undefined,
      model: undefined,
      reasoningEffort: undefined,
      lastContinuePrompt: undefined,
      context: undefined,
      archives: undefined,
      lease: undefined,
      ...value,
      createdAt,
      updatedAt: value.updatedAt ?? createdAt,
      driftEnabled: value.driftEnabled ?? false,
    };
  }

  private static resolveMessages(
    messages: ConversationLineValue[] | undefined,
  ): ConversationLineValue[] {
    return (messages ?? []).filter((message) => message.id !== 'intro' && message.id !== 'missing-key');
  }
}
