import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { drizzle as bunSqlDrizzle } from 'drizzle-orm/bun-sql';
import { migrate as migratePostgres } from 'drizzle-orm/bun-sql/migrator';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { ensureServerAdmin } from '../api/signup/store';
import { CONFIG } from '../config';
import { syncBuiltInRoles } from '../permissions/grants';
import { extractErrorMessage } from '../utils/error-handling';
import { logger } from '../utils/logger';
import { bunSqlConnection, openAsyncPostgres, type PgConnection } from './async-postgres';
import { type AsyncAppDatabase, openAsyncDatabase } from './async-sqlite';
import { rawAll, UPKEEP_QUERIES } from './dialect';
import { ACTIVE_DIALECT, POSTGRES_URL } from './dialect/active';
import * as schema from './sqlite/schema';

const POSTGRES_CONNECT_TIMEOUT_SECONDS = 10;

export type DatabaseTarget = { kind: 'sqlite'; path: string } | { kind: 'pg'; url: string };

const SCHEME = /^([a-z][a-z0-9+.-]+):/i;

export function databaseTarget(url: string): DatabaseTarget {
  const scheme = SCHEME.exec(url)?.[1]?.toLowerCase();
  if (scheme === undefined) return { kind: 'sqlite', path: url };
  if (POSTGRES_URL.test(url)) return { kind: 'pg', url };
  if (scheme === 'sqlite') return { kind: 'sqlite', path: url.replace(/^sqlite:(\/\/)?/i, '') };
  const unsupported =
    scheme === 'postgres' || scheme === 'postgresql'
      ? `DATABASE_URL starts with "${scheme}:" but not "${scheme}://".`
      : `DATABASE_URL uses the unsupported scheme "${scheme}:".`;
  throw new Error(
    `${unsupported} Use a SQLite file path (or sqlite:<path>), or postgres://user:password@host:5432/database.`
  );
}

export function describeDatabase(target: DatabaseTarget): string {
  if (target.kind === 'sqlite') return `SQLite at ${target.path}`;
  try {
    const { hostname, port, pathname } = new URL(target.url);
    return `Postgres at ${hostname}:${port || '5432'}${pathname}`;
  } catch {
    return 'Postgres';
  }
}

function openDatabase(url: string) {
  if (ACTIVE_DIALECT !== 'sqlite') {
    throw new Error(
      'This server runs on Postgres, so the SQLite handle is not available; use appContext().asyncDb.'
    );
  }
  const target = databaseTarget(url);
  if (target.kind !== 'sqlite') throw new Error('DATABASE_URL does not name a SQLite file');
  const dbDir = dirname(target.path);
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
  }

  const sqlite = new Database(target.path);

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

export interface PostgresStart {
  migrate(): Promise<void>;
  connect(): Promise<PgConnection>;
}

export function bunSqlStart(url: string): PostgresStart {
  const client = new Bun.SQL(url, {
    max: 1,
    connectionTimeout: POSTGRES_CONNECT_TIMEOUT_SECONDS,
  });
  return {
    migrate: () => migratePostgres(bunSqlDrizzle({ client }), { migrationsFolder: './drizzle-pg' }),
    async connect() {
      const reserved = await client.reserve();
      await reserved.unsafe(`SET statement_timeout = ${CONFIG.database.queryTimeout}`);
      return bunSqlConnection(reserved);
    },
  };
}

async function finishSetup(asyncDb: AsyncAppDatabase): Promise<void> {
  await syncBuiltInRoles(asyncDb);
  const admin = await asyncDb.transaction((tx) => ensureServerAdmin(tx));
  if (admin) logger.info('Made the oldest eligible account the server admin', { userId: admin });
}

export function driverReason(error: unknown): string {
  let root = error;
  while (root instanceof Error && root.cause instanceof Error) root = root.cause;
  const code = (root as { code?: unknown }).code;
  const message = extractErrorMessage(root);
  return typeof code === 'string' && !message.includes(code) ? `${message} (${code})` : message;
}

export async function startPostgres(start: PostgresStart, where: string): Promise<void> {
  let connection: PgConnection;
  try {
    await start.migrate();
    connection = await start.connect();
  } catch (error) {
    throw new Error(
      `Could not connect to ${where}: ${driverReason(error)}. Check DATABASE_URL and that the database server is running and reachable.`
    );
  }
  const { createPostgresAppContext, useAppContext } = await import('../app-context');
  const context = createPostgresAppContext(openAsyncPostgres(connection).db);
  useAppContext(context);
  await finishSetup(context.asyncDb);
}

export async function runMigrations(
  postgres: (url: string) => PostgresStart = bunSqlStart
): Promise<void> {
  try {
    logger.info('Running database migrations...');
    const target = databaseTarget(CONFIG.database.url);
    if (target.kind === 'pg') {
      await startPostgres(postgres(target.url), describeDatabase(target));
    } else {
      const db = getDb();
      migrate(db, { migrationsFolder: './drizzle' });
      foldUserEmailCase(db);
      await finishSetup(openAsyncDatabase(db.$client).db);
    }
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

export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    if (ACTIVE_DIALECT === 'pg') {
      const { appContext } = await import('../app-context');
      const rows = await rawAll<{ health: number }>(
        appContext().asyncDb,
        sql.raw(UPKEEP_QUERIES.health)
      );
      return Number(rows[0]?.health) === 1;
    }
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
  if (!CONFIG.database.appCheckpoints || ACTIVE_DIALECT !== 'sqlite') return null;
  forceCheckpointWAL();
  const timer = setInterval(checkpointWAL, intervalMs);
  return () => {
    clearInterval(timer);
    forceCheckpointWAL();
  };
}
