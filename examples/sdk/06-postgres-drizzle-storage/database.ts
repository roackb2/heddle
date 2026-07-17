import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { postgresStorageSchema } from './schema.js';

export type PostgresStorageDatabase = NodePgDatabase<typeof postgresStorageSchema>;

/** Reject an unbound adapter before any query can accidentally cross scopes. */
export function requireTrustedScopeId(scopeId: string): string {
  if (scopeId.trim().length === 0) {
    throw new RangeError('PostgreSQL storage scope id must not be empty.');
  }
  return scopeId;
}

export function hasPostgresErrorCode(error: unknown, code: string): boolean {
  let candidate = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof candidate !== 'object' || candidate === null) {
      return false;
    }
    if ('code' in candidate && candidate.code === code) {
      return true;
    }
    candidate = 'cause' in candidate ? candidate.cause : undefined;
  }
  return false;
}

export function storageErrorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
