import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { POSTGRES_REFERENCE_DATABASE_URL } from './example-config.js';
import { migratePostgresStorage } from './migration.js';
import { postgresStorageSchema } from './schema.js';

const pool = new Pool({
  connectionString: POSTGRES_REFERENCE_DATABASE_URL,
  application_name: 'heddle-postgres-reference-migrate',
});

try {
  const database = drizzle({ client: pool, schema: postgresStorageSchema });
  await migratePostgresStorage(database);
  console.log('Applied Heddle PostgreSQL reference migrations.');
} finally {
  await pool.end();
}
