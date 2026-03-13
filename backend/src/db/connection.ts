import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { CONFIG } from '../config';
import { DatabaseError } from '../errors';
import { logger } from '../utils/logger';
import * as schema from './schema.js';

// Database configuration
const DATABASE_URL = CONFIG.database.url;

// Ensure data directory exists
const dbDir = dirname(DATABASE_URL);
if (!existsSync(dbDir)) {
  mkdirSync(dbDir, { recursive: true });
}

// Create SQLite connection
const sqlite = new Database(DATABASE_URL);

// Enable WAL mode for better performance
sqlite.run('PRAGMA journal_mode = WAL');
sqlite.run('PRAGMA synchronous = NORMAL');
sqlite.run(`PRAGMA cache_size = ${CONFIG.database.cacheSize}`);
sqlite.run('PRAGMA foreign_keys = ON');
sqlite.run('PRAGMA temp_store = MEMORY');
sqlite.run(`PRAGMA busy_timeout = ${CONFIG.database.queryTimeout}`);

// Configure WAL auto-checkpoint to prevent data loss during hot reload
// Checkpoint after 1000 pages (~4MB) - SQLite default, good balance
// Auto-checkpoint handles most cases, reducing need for manual checkpoints
sqlite.run(`PRAGMA wal_autocheckpoint = ${CONFIG.database.walCheckpointPages}`);

// Create Drizzle instance
export const db = drizzle(sqlite, { schema });

/**
 * Database type alias — abstracts the dialect-specific Drizzle instance.
 * Repositories and services should use this instead of importing BunSQLiteDatabase directly.
 * When adding PostgreSQL support, this becomes a union: BunSQLiteDatabase | NodePgDatabase.
 */
export type AppDatabase = typeof db;

// ============================================================================
// TEST DATABASE SUPPORT
// ============================================================================

let testDb: typeof db | null = null;

/**
 * Set test database instance (for testing only)
 */
export function setTestDb(database: typeof db | null): void {
  testDb = database;
}

/**
 * Get the active database instance (test or production)
 */
export function getDb(): typeof db {
  return testDb || db;
}

// ============================================================================
// TRANSACTION HELPER
// ============================================================================

/**
 * Transaction wrapper for complex operations
 */
export async function transaction<T>(
  callback: (
    tx: Parameters<typeof db.transaction>[0] extends (tx: infer U) => unknown ? U : never
  ) => Promise<T>
): Promise<T> {
  try {
    return await getDb().transaction(callback);
  } catch (error) {
    const message = `Transaction failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
    logger.error(message, { error });
    throw new DatabaseError(message, error);
  }
}

// Migration function
export async function runMigrations() {
  try {
    logger.info('Running database migrations...');
    migrate(db, { migrationsFolder: './drizzle' });
    logger.info('Database migrations completed successfully');

    // Run data migration (idempotent — creates providers and backfills photo_refs)
    const { runDataMigration } = await import('./data-migration');
    await runDataMigration(sqlite);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const cause = error instanceof Error && 'cause' in error ? error.cause : undefined;
    logger.error('Migration failed', { error: message, cause });
    throw error;
  }
}

// Database health check
export function checkDatabaseHealth(): boolean {
  try {
    const result = sqlite.query('SELECT 1 as health').get() as { health: number } | null;
    return result?.health === 1;
  } catch (error) {
    logger.error('Database health check failed', { error });
    return false;
  }
}

// Checkpoint WAL to persist data to main database file
export function checkpointWAL(): void {
  try {
    // TRUNCATE mode: checkpoint and truncate WAL file
    const result = sqlite.query('PRAGMA wal_checkpoint(TRUNCATE)').get() as {
      busy: number;
      log: number;
      checkpointed: number;
    } | null;

    // Only log if there was actual work done
    if (result && result.checkpointed > 0) {
      logger.info(
        `WAL checkpoint completed: ${result.checkpointed} pages written, ${result.log} pages in WAL`
      );
    }
  } catch (error) {
    logger.error('WAL checkpoint failed', { error });
  }
}

// Force immediate checkpoint - useful for critical operations
export function forceCheckpointWAL(): void {
  try {
    // RESTART mode: force checkpoint even if there are readers
    const result = sqlite.query('PRAGMA wal_checkpoint(RESTART)').get() as {
      busy: number;
      log: number;
      checkpointed: number;
    } | null;

    // Only log if there was actual work done
    if (result && result.checkpointed > 0) {
      logger.info(`Forced WAL checkpoint completed: ${result.checkpointed} pages written`);
    }
  } catch (error) {
    logger.error('Forced WAL checkpoint failed', { error });
  }
}

// Graceful shutdown
export function closeDatabaseConnection() {
  try {
    sqlite.close();
    logger.info('Database connection closed');
  } catch (error) {
    logger.error('Error closing database connection', { error });
  }
}

// Export the sqlite instance for direct access if needed
export { sqlite };
