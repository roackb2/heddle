import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './examples/sdk/06-persistence/postgres-drizzle/schema.ts',
  out: './examples/sdk/06-persistence/postgres-drizzle/drizzle',
});
