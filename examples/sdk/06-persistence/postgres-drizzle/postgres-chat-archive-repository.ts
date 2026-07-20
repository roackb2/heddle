import { and, eq, sql } from 'drizzle-orm';
import {
  ChatArchivePersistenceCodec,
  ChatArchiveStorageCorruptionError,
  type AppendChatArchiveInput,
  type AppendChatArchiveResult,
  type ChatArchiveManifest,
  type ChatArchiveRepository,
} from '../../../../src/index.js';
import {
  hasPostgresErrorCode,
  requireTrustedScopeId,
  storageErrorDetail,
  type PostgresStorageDatabase,
} from './database.js';
import {
  heddleChatSessionArchiveHeads,
  heddleChatSessionArchives,
} from './schema.js';

type PostgresChatArchiveRepositoryOptions = {
  database: PostgresStorageDatabase;
  /** Must be the same trusted server-side scope used by the session repository. */
  scopeId: string;
};

type SummaryAddress = {
  sessionId: string;
  archiveId: string;
};

const locatorProtocol = 'heddle-postgres:';
const locatorHost = 'conversation-archive';

/**
 * Reference PostgreSQL implementation of Heddle's append-only archive port.
 *
 * Each append locks one manifest head and commits immutable messages, summary,
 * and the next manifest together. Locators never select the authorization
 * scope; the repository instance remains bound to its trusted host scope.
 */
export class PostgresChatArchiveRepository implements ChatArchiveRepository {
  private readonly database: PostgresStorageDatabase;
  private readonly scopeId: string;

  constructor(options: PostgresChatArchiveRepositoryOptions) {
    this.database = options.database;
    this.scopeId = requireTrustedScopeId(options.scopeId);
  }

  async loadManifest(sessionId: string): Promise<ChatArchiveManifest> {
    const [row] = await this.database
      .select({ manifest: heddleChatSessionArchiveHeads.manifest })
      .from(heddleChatSessionArchiveHeads)
      .where(and(
        eq(heddleChatSessionArchiveHeads.scopeId, this.scopeId),
        eq(heddleChatSessionArchiveHeads.sessionId, sessionId),
      ))
      .limit(1);

    return row
      ? this.parseManifest(row.manifest, sessionId)
      : ChatArchivePersistenceCodec.emptyManifest(sessionId);
  }

  async readSummary(summaryLocator: string): Promise<string | undefined> {
    const address = PostgresChatArchiveRepository.parseSummaryLocator(summaryLocator);
    const [row] = await this.database
      .select({ summary: heddleChatSessionArchives.summary })
      .from(heddleChatSessionArchives)
      .where(and(
        eq(heddleChatSessionArchives.scopeId, this.scopeId),
        eq(heddleChatSessionArchives.sessionId, address.sessionId),
        eq(heddleChatSessionArchives.archiveId, address.archiveId),
      ))
      .limit(1);
    return row?.summary;
  }

  async append(input: AppendChatArchiveInput): Promise<AppendChatArchiveResult> {
    try {
      return await this.database.transaction(async (transaction) => {
        const now = new Date().toISOString();
        const emptyManifest = ChatArchivePersistenceCodec.emptyManifest(input.sessionId);
        await transaction
          .insert(heddleChatSessionArchiveHeads)
          .values({
            scopeId: this.scopeId,
            sessionId: input.sessionId,
            manifest: emptyManifest,
            updatedAt: now,
          })
          .onConflictDoNothing({
            target: [
              heddleChatSessionArchiveHeads.scopeId,
              heddleChatSessionArchiveHeads.sessionId,
            ],
          });

        const locked = await transaction.execute<{ manifest: unknown }>(sql`
          select ${heddleChatSessionArchiveHeads.manifest} as manifest
          from ${heddleChatSessionArchiveHeads}
          where ${heddleChatSessionArchiveHeads.scopeId} = ${this.scopeId}
            and ${heddleChatSessionArchiveHeads.sessionId} = ${input.sessionId}
          for update
        `);
        const [head] = locked.rows;
        if (!head) {
          throw new Error('archive manifest head was not created');
        }

        const current = this.parseManifest(head.manifest, input.sessionId);
        const archive = {
          ...input.archive,
          path: PostgresChatArchiveRepository.archiveLocator(
            input.sessionId,
            input.archive.id,
            'messages',
          ),
          summaryPath: PostgresChatArchiveRepository.archiveLocator(
            input.sessionId,
            input.archive.id,
            'summary',
          ),
        };
        const manifest = ChatArchivePersistenceCodec.appendArchive(current, archive);

        await transaction.insert(heddleChatSessionArchives).values({
          scopeId: this.scopeId,
          sessionId: input.sessionId,
          archiveId: archive.id,
          archiveRecord: archive,
          messages: input.messages,
          summary: input.summary,
          createdAt: archive.createdAt,
        });
        const updatedHeads = await transaction
          .update(heddleChatSessionArchiveHeads)
          .set({ manifest, updatedAt: now })
          .where(and(
            eq(heddleChatSessionArchiveHeads.scopeId, this.scopeId),
            eq(heddleChatSessionArchiveHeads.sessionId, input.sessionId),
          ))
          .returning({ sessionId: heddleChatSessionArchiveHeads.sessionId });
        if (updatedHeads.length !== 1) {
          throw new Error('archive manifest head disappeared during append');
        }

        return { archive, manifest };
      });
    } catch (error) {
      if (hasPostgresErrorCode(error, '23505')) {
        throw new ChatArchiveStorageCorruptionError(
          PostgresChatArchiveRepository.manifestLocator(input.sessionId),
          `archive ${input.archive.id} already exists outside the current manifest`,
        );
      }
      throw error;
    }
  }

  private parseManifest(value: unknown, sessionId: string): ChatArchiveManifest {
    try {
      return ChatArchivePersistenceCodec.parseManifest(value, sessionId);
    } catch (error) {
      if (error instanceof ChatArchiveStorageCorruptionError) {
        throw error;
      }
      throw new ChatArchiveStorageCorruptionError(
        PostgresChatArchiveRepository.manifestLocator(sessionId),
        storageErrorDetail(error),
      );
    }
  }

  private static archiveLocator(
    sessionId: string,
    archiveId: string,
    content: 'messages' | 'summary',
  ): string {
    return `${locatorProtocol}//${locatorHost}/${encodeURIComponent(sessionId)}/${encodeURIComponent(archiveId)}/${content}`;
  }

  private static manifestLocator(sessionId: string): string {
    return `${locatorProtocol}//${locatorHost}/${encodeURIComponent(sessionId)}/manifest`;
  }

  private static parseSummaryLocator(locator: string): SummaryAddress {
    try {
      const url = new URL(locator);
      const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      const [sessionId, archiveId, content] = segments;
      const valid = url.protocol === locatorProtocol
        && url.hostname === locatorHost
        && url.username === ''
        && url.password === ''
        && url.port === ''
        && url.search === ''
        && url.hash === ''
        && segments.length === 3
        && Boolean(sessionId)
        && Boolean(archiveId)
        && content === 'summary';
      if (!valid || !sessionId || !archiveId) {
        throw new Error('expected a repository-owned summary locator');
      }
      return { sessionId, archiveId };
    } catch (error) {
      throw new ChatArchiveStorageCorruptionError(locator, storageErrorDetail(error));
    }
  }
}
