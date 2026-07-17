import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './examples/sdk/06-postgres-drizzle-storage/schema.ts',
  out: './examples/sdk/06-postgres-drizzle-storage/drizzle',
});
