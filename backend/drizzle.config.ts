import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/sqlite/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.DATABASE_URL || './data/vroom.db',
  },
  verbose: true,
  strict: true,
});