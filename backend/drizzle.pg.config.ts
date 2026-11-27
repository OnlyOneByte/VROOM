import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/pg/schema.ts',
  out: './drizzle-pg',
  dialect: 'postgresql',
  verbose: true,
  strict: true,
});
