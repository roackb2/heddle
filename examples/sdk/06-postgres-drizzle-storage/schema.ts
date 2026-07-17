import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

/**
 * Host-owned PostgreSQL schema for Heddle's session and archive ports.
 *
 * JSONB keeps Heddle's complete opaque records intact. Only fields required by
 * catalog ordering and filtering are duplicated into relational columns.
 */
export const heddleChatSessions = pgTable('heddle_chat_sessions', {
  scopeId: text('scope_id').notNull(),
  id: text('id').notNull(),
  revision: bigint('revision', { mode: 'number' }).notNull(),
  session: jsonb('session').$type<unknown>().notNull(),
  workspaceId: text('workspace_id'),
  pinned: boolean('pinned').notNull(),
  archivedAt: timestamp('archived_at', {
    withTimezone: true,
    mode: 'string',
    precision: 3,
  }),
  updatedAt: timestamp('updated_at', {
    withTimezone: true,
    mode: 'string',
    precision: 3,
  }).notNull(),
}, (table) => [
  primaryKey({
    name: 'heddle_chat_sessions_pk',
    columns: [table.scopeId, table.id],
  }),
  check('heddle_chat_sessions_revision_positive', sql`${table.revision} > 0`),
  index('heddle_chat_sessions_catalog_idx').using(
    'btree',
    table.scopeId.asc(),
    table.pinned.desc(),
    table.updatedAt.desc(),
    sql`${table.id} collate "C" asc`,
  ),
]);

export const heddleChatSessionArchives = pgTable('heddle_chat_session_archives', {
  scopeId: text('scope_id').notNull(),
  sessionId: text('session_id').notNull(),
  archiveId: text('archive_id').notNull(),
  archiveRecord: jsonb('archive_record').$type<unknown>().notNull(),
  messages: jsonb('messages').$type<unknown>().notNull(),
  summary: text('summary').notNull(),
  createdAt: timestamp('created_at', {
    withTimezone: true,
    mode: 'string',
    precision: 3,
  }).notNull(),
}, (table) => [
  primaryKey({
    name: 'heddle_chat_session_archives_pk',
    columns: [table.scopeId, table.sessionId, table.archiveId],
  }),
]);

export const heddleChatSessionArchiveHeads = pgTable('heddle_chat_session_archive_heads', {
  scopeId: text('scope_id').notNull(),
  sessionId: text('session_id').notNull(),
  manifest: jsonb('manifest').$type<unknown>().notNull(),
  updatedAt: timestamp('updated_at', {
    withTimezone: true,
    mode: 'string',
    precision: 3,
  }).notNull(),
}, (table) => [
  primaryKey({
    name: 'heddle_chat_session_archive_heads_pk',
    columns: [table.scopeId, table.sessionId],
  }),
]);

export const postgresStorageSchema = {
  heddleChatSessions,
  heddleChatSessionArchives,
  heddleChatSessionArchiveHeads,
};
