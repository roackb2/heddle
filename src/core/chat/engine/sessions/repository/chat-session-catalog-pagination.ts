/**
 * Canonical ordering and opaque cursor behavior for chat-session catalogs.
 *
 * Database adapters must use the equivalent order and predicate in SQL:
 * pinned descending, updatedAt descending, then id ascending with binary/C
 * collation. These helpers own the in-process form and cursor wire format.
 */
import { z } from 'zod';
import { InvalidChatSessionCursorError } from './errors.js';
import type { ChatSessionCatalogEntry } from './types.js';

export type ChatSessionCatalogCursor = Pick<
  ChatSessionCatalogEntry,
  'id' | 'pinned' | 'updatedAt'
>;

const ChatSessionCatalogCursorSchema = z.object({
  id: z.string(),
  pinned: z.boolean(),
  updatedAt: z.string(),
}).strict();

export class ChatSessionCatalogPagination {
  static compare(
    left: ChatSessionCatalogCursor,
    right: ChatSessionCatalogCursor,
  ): number {
    if (left.pinned !== right.pinned) {
      return left.pinned ? -1 : 1;
    }

    const updatedAtOrder = ChatSessionCatalogPagination.compareText(
      right.updatedAt,
      left.updatedAt,
    );
    return updatedAtOrder || ChatSessionCatalogPagination.compareText(left.id, right.id);
  }

  static isAfterCursor(
    entry: ChatSessionCatalogCursor,
    cursor: ChatSessionCatalogCursor,
  ): boolean {
    return ChatSessionCatalogPagination.compare(entry, cursor) > 0;
  }

  static encodeCursor(entry: ChatSessionCatalogCursor): string {
    const cursor = ChatSessionCatalogCursorSchema.parse({
      id: entry.id,
      pinned: entry.pinned,
      updatedAt: entry.updatedAt,
    });
    return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
  }

  static decodeCursor(cursor: string): ChatSessionCatalogCursor {
    try {
      const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
      return ChatSessionCatalogCursorSchema.parse(value);
    } catch {
      throw new InvalidChatSessionCursorError();
    }
  }

  static validatePageLimit(limit: number): void {
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      throw new RangeError('Chat session page limit must be an integer between 1 and 200.');
    }
  }

  private static compareText(left: string, right: string): number {
    return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
  }
}
