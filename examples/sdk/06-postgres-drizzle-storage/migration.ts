import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { PostgresStorageDatabase } from './database.js';

const migrationsFolder = fileURLToPath(new URL('./drizzle', import.meta.url));

/** Apply the checked-in Drizzle migration through the host-owned connection. */
export async function migratePostgresStorage(
  database: PostgresStorageDatabase,
): Promise<void> {
  await migrate(database, { migrationsFolder });
}
