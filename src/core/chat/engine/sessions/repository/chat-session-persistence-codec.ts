/**
 * Database-neutral validation and catalog projection for session adapters.
 *
 * This codec is deliberately stricter than Heddle's private legacy-file read
 * path. A remote adapter must fail a malformed opaque record rather than
 * silently drop model history, turns, queue state, or compaction metadata.
 */
import type { ChatSession } from '@/core/chat/types.js';
import {
  CatalogEntryWriteSchema,
  ChatSessionRecordSchema,
} from './chat-session-schemas.js';
import type { ChatSessionCatalogEntry } from './types.js';

export class ChatSessionPersistenceCodec {
  /** Parse and normalize one complete opaque record read from durable storage. */
  static parseRecord(value: unknown): ChatSession {
    return ChatSessionRecordSchema.parse(value);
  }

  /**
   * Project the columns needed for catalog queries without exposing transcript
   * or tool payloads to the host's browser-facing catalog.
   */
  static projectCatalogEntry(
    session: ChatSession,
    revision: number,
  ): ChatSessionCatalogEntry {
    return CatalogEntryWriteSchema.parse({
      ...session,
      pinned: session.pinned ?? false,
      revision,
    });
  }
}
