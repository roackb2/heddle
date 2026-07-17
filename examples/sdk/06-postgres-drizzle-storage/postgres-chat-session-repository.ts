import {
  and,
  desc,
  eq,
  isNotNull,
  isNull,
  sql,
  type SQL,
} from 'drizzle-orm';
import {
  ChatSessionAlreadyExistsError,
  ChatSessionCatalogPagination,
  ChatSessionPersistenceCodec,
  ChatSessionRevisionConflictError,
  ChatSessionStorageCorruptionError,
  type ChatSession,
  type ChatSessionCatalogCursor,
  type ChatSessionCatalogEntry,
  type ChatSessionCatalogPage,
  type ChatSessionRepository,
  type DeleteChatSessionInput,
  type ListChatSessionsInput,
  type StoredChatSession,
  type UpdateChatSessionInput,
} from '../../../src/index.js';
import {
  hasPostgresErrorCode,
  requireTrustedScopeId,
  storageErrorDetail,
  type PostgresStorageDatabase,
} from './database.js';
import { heddleChatSessions } from './schema.js';

type PostgresChatSessionRepositoryOptions = {
  database: PostgresStorageDatabase;
  /** Server-authenticated tenant/account boundary; never take this from a request body. */
  scopeId: string;
};

type RawSessionRow = {
  id: string;
  session: unknown;
  revision: number | string;
};

/**
 * Reference PostgreSQL implementation of Heddle's revisioned session port.
 *
 * The complete Heddle record stays opaque JSONB. SQL owns atomic uniqueness,
 * revision compare-and-swap, tenant filtering, and canonical cursor order.
 */
export class PostgresChatSessionRepository implements ChatSessionRepository {
  private readonly database: PostgresStorageDatabase;
  private readonly scopeId: string;

  constructor(options: PostgresChatSessionRepositoryOptions) {
    this.database = options.database;
    this.scopeId = requireTrustedScopeId(options.scopeId);
  }

  async list(input: ListChatSessionsInput): Promise<ChatSessionCatalogPage> {
    ChatSessionCatalogPagination.validatePageLimit(input.limit);
    const cursor = input.cursor
      ? ChatSessionCatalogPagination.decodeCursor(input.cursor)
      : undefined;
    const rows = await this.database
      .select({
        id: heddleChatSessions.id,
        session: heddleChatSessions.session,
        revision: heddleChatSessions.revision,
      })
      .from(heddleChatSessions)
      .where(and(
        eq(heddleChatSessions.scopeId, this.scopeId),
        input.workspaceId === undefined
          ? undefined
          : eq(heddleChatSessions.workspaceId, input.workspaceId),
        PostgresChatSessionRepository.archivePredicate(input.archived),
        PostgresChatSessionRepository.cursorPredicate(cursor),
      ))
      .orderBy(
        desc(heddleChatSessions.pinned),
        desc(heddleChatSessions.updatedAt),
        sql`${heddleChatSessions.id} collate "C" asc`,
      )
      .limit(input.limit + 1);

    const hasNextPage = rows.length > input.limit;
    const items = rows
      .slice(0, input.limit)
      .map((row) => this.projectCatalogEntry(row));
    const lastIncluded = items.at(-1);

    return {
      items,
      ...(hasNextPage && lastIncluded
        ? { nextCursor: ChatSessionCatalogPagination.encodeCursor(lastIncluded) }
        : {}),
    };
  }

  async read(sessionId: string): Promise<StoredChatSession | undefined> {
    const [row] = await this.database
      .select({
        id: heddleChatSessions.id,
        session: heddleChatSessions.session,
        revision: heddleChatSessions.revision,
      })
      .from(heddleChatSessions)
      .where(and(
        eq(heddleChatSessions.scopeId, this.scopeId),
        eq(heddleChatSessions.id, sessionId),
      ))
      .limit(1);

    return row ? this.parseStoredSession(row) : undefined;
  }

  async create(input: ChatSession): Promise<StoredChatSession> {
    const session = ChatSessionPersistenceCodec.parseRecord(input);
    const projection = ChatSessionPersistenceCodec.projectCatalogEntry(session, 1);

    try {
      const [row] = await this.database
        .insert(heddleChatSessions)
        .values({
          scopeId: this.scopeId,
          id: session.id,
          revision: 1,
          session,
          workspaceId: projection.workspaceId ?? null,
          pinned: projection.pinned,
          archivedAt: projection.archivedAt ?? null,
          updatedAt: projection.updatedAt,
        })
        .returning({
          id: heddleChatSessions.id,
          session: heddleChatSessions.session,
          revision: heddleChatSessions.revision,
        });
      return this.parseStoredSession(row);
    } catch (error) {
      if (hasPostgresErrorCode(error, '23505')) {
        throw new ChatSessionAlreadyExistsError(session.id);
      }
      throw error;
    }
  }

  async update(input: UpdateChatSessionInput): Promise<StoredChatSession | undefined> {
    const session = ChatSessionPersistenceCodec.parseRecord(input.session);
    const projection = ChatSessionPersistenceCodec.projectCatalogEntry(
      session,
      input.expectedRevision + 1,
    );

    return this.database.transaction(async (transaction) => {
      const updated = await transaction.execute<RawSessionRow>(sql`
        update ${heddleChatSessions}
        set
          session = ${JSON.stringify(session)}::jsonb,
          revision = revision + 1,
          workspace_id = ${projection.workspaceId ?? null},
          pinned = ${projection.pinned},
          archived_at = ${projection.archivedAt ?? null},
          updated_at = ${projection.updatedAt}
        where ${heddleChatSessions.scopeId} = ${this.scopeId}
          and ${heddleChatSessions.id} = ${session.id}
          and ${heddleChatSessions.revision} = ${input.expectedRevision}
        returning
          ${heddleChatSessions.id} as id,
          ${heddleChatSessions.session} as session,
          ${heddleChatSessions.revision} as revision
      `);
      const [row] = updated.rows;
      if (row) {
        return this.parseStoredSession(row);
      }

      const actualRevision = await this.readRevision(transaction, session.id);
      if (actualRevision === undefined) {
        return undefined;
      }
      throw new ChatSessionRevisionConflictError(
        session.id,
        input.expectedRevision,
        actualRevision,
      );
    });
  }

  async delete(input: DeleteChatSessionInput): Promise<boolean> {
    return this.database.transaction(async (transaction) => {
      const deleted = await transaction.execute<{ revision: number | string }>(sql`
        delete from ${heddleChatSessions}
        where ${heddleChatSessions.scopeId} = ${this.scopeId}
          and ${heddleChatSessions.id} = ${input.sessionId}
          and ${heddleChatSessions.revision} = ${input.expectedRevision}
        returning ${heddleChatSessions.revision} as revision
      `);
      if (deleted.rows.length > 0) {
        return true;
      }

      const actualRevision = await this.readRevision(transaction, input.sessionId);
      if (actualRevision === undefined) {
        return false;
      }
      throw new ChatSessionRevisionConflictError(
        input.sessionId,
        input.expectedRevision,
        actualRevision,
      );
    });
  }

  private async readRevision(
    database: PostgresStorageDatabase,
    sessionId: string,
  ): Promise<number | undefined> {
    const [row] = await database
      .select({ revision: heddleChatSessions.revision })
      .from(heddleChatSessions)
      .where(and(
        eq(heddleChatSessions.scopeId, this.scopeId),
        eq(heddleChatSessions.id, sessionId),
      ))
      .for('update')
      .limit(1);
    return row?.revision;
  }

  private projectCatalogEntry(row: RawSessionRow): ChatSessionCatalogEntry {
    const stored = this.parseStoredSession(row);
    return ChatSessionPersistenceCodec.projectCatalogEntry(
      stored.session,
      stored.revision,
    );
  }

  private parseStoredSession(row: RawSessionRow): StoredChatSession {
    try {
      const revision = PostgresChatSessionRepository.parseRevision(row.revision);
      return {
        session: ChatSessionPersistenceCodec.parseRecord(row.session),
        revision,
      };
    } catch (error) {
      throw new ChatSessionStorageCorruptionError(
        `heddle-postgres://chat-session/${encodeURIComponent(row.id)}`,
        storageErrorDetail(error),
      );
    }
  }

  private static parseRevision(value: number | string): number {
    const revision = Number(value);
    if (!Number.isSafeInteger(revision) || revision < 1) {
      throw new Error(`invalid revision ${String(value)}`);
    }
    return revision;
  }

  private static archivePredicate(archived: boolean | undefined): SQL | undefined {
    if (archived === undefined) {
      return undefined;
    }
    return archived
      ? isNotNull(heddleChatSessions.archivedAt)
      : isNull(heddleChatSessions.archivedAt);
  }

  private static cursorPredicate(cursor: ChatSessionCatalogCursor | undefined): SQL | undefined {
    if (!cursor) {
      return undefined;
    }

    return sql`
      (
        (${heddleChatSessions.pinned} = false and ${cursor.pinned} = true)
        or (
          ${heddleChatSessions.pinned} = ${cursor.pinned}
          and (
            ${heddleChatSessions.updatedAt} < ${cursor.updatedAt}::timestamptz
            or (
              ${heddleChatSessions.updatedAt} = ${cursor.updatedAt}::timestamptz
              and ${heddleChatSessions.id} collate "C" > ${cursor.id}
            )
          )
        )
      )
    `;
  }
}
