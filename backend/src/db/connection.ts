import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { ensureServerAdmin } from '../api/signup/store';
import { CONFIG } from '../config';
import { handleDatabaseError, isAppError, isSyncError } from '../errors';
import { syncBuiltInRoles } from '../permissions/grants';
import { extractErrorMessage } from '../utils/error-handling';
import { logger } from '../utils/logger';
import { openAsyncDatabase } from './async-sqlite';
import type { UPKEEP_QUERIES } from './dialect';
import * as schema from './schema.js';

function openDatabase(url: string) {
  const dbDir = dirname(url);
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
  }

  const sqlite = new Database(url);

  sqlite.run('PRAGMA journal_mode = WAL');
  sqlite.run('PRAGMA synchronous = NORMAL');
  sqlite.run(`PRAGMA cache_size = ${CONFIG.database.cacheSize}`);
  sqlite.run('PRAGMA foreign_keys = ON');
  sqlite.run('PRAGMA temp_store = MEMORY');
  sqlite.run(`PRAGMA busy_timeout = ${CONFIG.database.queryTimeout}`);

  sqlite.run(`PRAGMA wal_autocheckpoint = ${CONFIG.database.walCheckpointPages}`);

  return drizzle(sqlite, { schema });
}

export type AppDatabase = ReturnType<typeof openDatabase>;

let opened: AppDatabase | null = null;

export function getDb(): AppDatabase {
  opened ??= openDatabase(CONFIG.database.url);
  return opened;
}

type AppTransaction = Parameters<AppDatabase['transaction']>[0] extends (tx: infer U) => unknown
  ? U
  : never;

// bun:sqlite transactions must use a synchronous callback: an awaited statement autocommits on its own.
export async function transaction<T>(
  callback: (tx: AppTransaction) => T | Promise<T>,
  database: AppDatabase = getDb()
): Promise<T> {
  try {
    return (await database.transaction(callback as Parameters<AppDatabase['transaction']>[0])) as T;
  } catch (error) {
    if (isAppError(error) || isSyncError(error)) throw error;
    logger.error('Transaction failed', { error });
    throw handleDatabaseError(error);
  }
}

export function foldUserEmailCase(database: AppDatabase): void {
  const folded = database.transaction((tx) => {
    const rows = tx
      .select({ id: schema.users.id, email: schema.users.email })
      .from(schema.users)
      .orderBy(schema.users.id)
      .all();
    const idsByFoldedEmail = new Map<string, string[]>();
    for (const { id, email } of rows) {
      const key = email.toLowerCase();
      idsByFoldedEmail.set(key, [...(idsByFoldedEmail.get(key) ?? []), id]);
    }
    const clashes = [...idsByFoldedEmail.values()].filter((ids) => ids.length > 1);
    if (clashes.length > 0) {
      throw new Error(
        `Startup stopped: some accounts have emails that differ only by letter case. No email was changed; migrations that already ran stay applied. In each group of user ids below, change users.email for all but one id (or remove those accounts), then restart. See docs/conventions/DatabaseMigrations.md § Production for running SQL against the database: ${clashes.map((ids) => ids.join(', ')).join('; ')}`
      );
    }

    const unfolded = rows.filter(({ email }) => email !== email.toLowerCase());
    for (const { id, email } of unfolded) {
      tx.update(schema.users)
        .set({ email: email.toLowerCase() })
        .where(eq(schema.users.id, id))
        .run();
    }
    return unfolded.length;
  });
  if (folded > 0) logger.info(`Lowercased ${folded} user email(s)`);
}

export function runMigrations(): void {
  try {
    logger.info('Running database migrations...');
    const db = getDb();
    migrate(db, { migrationsFolder: './drizzle' });
    foldUserEmailCase(db);
    syncBuiltInRoles(db);
    const admin = ensureServerAdmin(db);
    if (admin) logger.info('Made the oldest eligible account the server admin', { userId: admin });
    logger.info('Database migrations completed successfully');
  } catch (error) {
    const message = extractErrorMessage(error);
    const cause = error instanceof Error && 'cause' in error ? error.cause : undefined;
    logger.error('Migration failed', { error: message, cause });
    throw error;
  }
}

function upkeep(kind: keyof typeof UPKEEP_QUERIES): unknown {
  return openAsyncDatabase(getDb().$client).upkeep(kind);
}

function checkpointPossible(): boolean {
  return !getDb().$client.inTransaction;
}

export function checkDatabaseHealth(): boolean {
  try {
    const result = upkeep('health') as { health: number } | null;
    return result?.health === 1;
  } catch (error) {
    logger.error('Database health check failed', { error });
    return false;
  }
}

export function checkpointWAL(): void {
  try {
    if (!checkpointPossible()) return;
    const result = upkeep('checkpoint') as {
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
    if (!checkpointPossible()) return;
    const result = upkeep('forceCheckpoint') as {
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

export function startWalCheckpoints(intervalMs: number): (() => void) | null {
  if (!CONFIG.database.appCheckpoints) return null;
  forceCheckpointWAL();
  const timer = setInterval(checkpointWAL, intervalMs);
  return () => {
    clearInterval(timer);
    forceCheckpointWAL();
  };
}
