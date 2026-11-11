import type { Database as BunDatabase } from 'bun:sqlite';

export async function runDataMigration(_sqlite: BunDatabase): Promise<void> {}
