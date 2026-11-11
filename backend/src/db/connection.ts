import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { CONFIG } from '../config';
import { DatabaseError } from '../errors';
import { extractErrorMessage } from '../utils/error-handling';
import { logger } from '../utils/logger';
import * as schema from './schema.js';

const DATABASE_URL = CONFIG.database.url;

const dbDir = dirname(DATABASE_URL);
if (!existsSync(dbDir)) {
  mkdirSync(dbDir, { recursive: true });
}

const sqlite = new Database(DATABASE_URL);

sqlite.run('PRAGMA journal_mode = WAL');
sqlite.run('PRAGMA synchronous = NORMAL');
sqlite.run(`PRAGMA cache_size = ${CONFIG.database.cacheSize}`);
sqlite.run('PRAGMA foreign_keys = ON');
sqlite.run('PRAGMA temp_store = MEMORY');
sqlite.run(`PRAGMA busy_timeout = ${CONFIG.database.queryTimeout}`);

sqlite.run(`PRAGMA wal_autocheckpoint = ${CONFIG.database.walCheckpointPages}`);

export const db = drizzle(sqlite, { schema });

// Repositories depend on this alias rather than the dialect-specific Drizzle type.
export type AppDatabase = typeof db;

// No test override: repositories take an AppDatabase in their constructor, so tests build one over
// their own in-memory database.
export function getDb(): typeof db {
  return db;
}

// Use a synchronous callback for multi-write transactions. With an async callback, each awaited
// statement autocommits on its own, so a throw partway through does not roll back earlier writes.
export async function transaction<T>(
  callback: (
    tx: Parameters<typeof db.transaction>[0] extends (tx: infer U) => unknown ? U : never
  ) => T | Promise<T>
): Promise<T> {
  try {
    return (await getDb().transaction(callback as Parameters<typeof db.transaction>[0])) as T;
  } catch (error) {
    const message = `Transaction failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
    logger.error(message, { error });
    throw new DatabaseError(message, error);
  }
}

export async function runMigrations() {
  try {
    logger.info('Running database migrations...');
    migrate(db, { migrationsFolder: './drizzle' });
    logger.info('Database migrations completed successfully');

    const { runDataMigration } = await import('./data-migration');
    await runDataMigration(sqlite);
  } catch (error) {
    const message = extractErrorMessage(error);
    const cause = error instanceof Error && 'cause' in error ? error.cause : undefined;
    logger.error('Migration failed', { error: message, cause });
    throw error;
  }
}

export function checkDatabaseHealth(): boolean {
  try {
    const result = sqlite.query('SELECT 1 as health').get() as { health: number } | null;
    return result?.health === 1;
  } catch (error) {
    logger.error('Database health check failed', { error });
    return false;
  }
}

export function checkpointWAL(): void {
  try {
    const result = sqlite.query('PRAGMA wal_checkpoint(TRUNCATE)').get() as {
      busy: number;
      log: number;
      checkpointed: number;
    } | null;

    if (result && result.checkpointed > 0) {
      logger.info(
        `WAL checkpoint completed: ${result.checkpointed} pages written, ${result.log} pages in WAL`
      );
    }
  } catch (error) {
    logger.error('WAL checkpoint failed', { error });
  }
}

export function forceCheckpointWAL(): void {
  try {
    const result = sqlite.query('PRAGMA wal_checkpoint(RESTART)').get() as {
      busy: number;
      log: number;
      checkpointed: number;
    } | null;

    if (result && result.checkpointed > 0) {
      logger.info(`Forced WAL checkpoint completed: ${result.checkpointed} pages written`);
    }
  } catch (error) {
    logger.error('Forced WAL checkpoint failed', { error });
  }
}
