import type { Database as BunDatabase } from 'bun:sqlite';

/**
 * Run any one-time data migrations that need to happen after schema migrations.
 * Currently a no-op — add migration logic here when needed.
 */
export async function runDataMigration(_sqlite: BunDatabase): Promise<void> {
  // No migrations needed at this time
}
