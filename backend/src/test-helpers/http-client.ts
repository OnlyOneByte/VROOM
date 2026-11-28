import { afterEach, beforeEach } from 'bun:test';
import type { Hono } from 'hono';
import { pgliteTestSql, sqliteTestSql, type TestSql } from './test-sql';

export const SETUP_TIMEOUT_MS = 30_000;

export function socketFrom(address: string) {
  const family = address.includes(':') ? 'IPv6' : 'IPv4';
  return { requestIP: () => ({ address, family, port: 40000 }) };
}

export async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

export interface DataEnvelope<T> {
  data: T;
}

export interface PaginatedEnvelope<T> {
  data: T[];
  pagination: { totalCount: number; limit: number; offset: number; hasMore: boolean };
}

export interface TestUser {
  id: string;
  email: string;
  displayName: string;
}

export interface TestApp {
  app: Hono;
  user: TestUser;
  sqlite: import('bun:sqlite').Database;
  sql: TestSql;
  cookie: string;
  authed: (method: string, path: string, body?: unknown) => Promise<Response>;
  anon: (method: string, path: string, body?: unknown) => Promise<Response>;
  close: () => void;
}

export function useTestApp(seedUser: Partial<TestUser> = {}): () => TestApp {
  let current: TestApp | undefined;
  beforeEach(async () => {
    current = await createTestApp(seedUser);
  }, SETUP_TIMEOUT_MS);
  afterEach(() => {
    current?.close();
    current = undefined;
  });
  return () => {
    if (!current) throw new Error('useTestApp: the test app is only available inside a test');
    return current;
  };
}

let counter = 0;
let migrated = false;

export const ON_POSTGRES = process.env.TEST_DB === 'postgres';

let postgres: Promise<import('@electric-sql/pglite').PGlite> | undefined;

const NO_RAW_SQLITE = new Proxy({} as import('bun:sqlite').Database, {
  get() {
    throw new Error(
      'This test sets up data with raw SQLite, so it cannot run with TEST_DB=postgres yet'
    );
  },
});

async function migratedPostgres(): Promise<import('@electric-sql/pglite').PGlite> {
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { migrate } = await import('drizzle-orm/pglite/migrator');
  const { openAsyncPostgres, pgliteConnection } = await import('../db/async-postgres');
  const { createPostgresAppContext, installAppContext } = await import('../app-context');
  const client = new PGlite();
  await migrate(drizzle(client), {
    migrationsFolder: `${import.meta.dir}/../../drizzle-pg`,
  });
  installAppContext(createPostgresAppContext(openAsyncPostgres(pgliteConnection(client)).db));
  return client;
}

export async function openPostgresTestDatabase(): Promise<import('@electric-sql/pglite').PGlite> {
  if (!postgres) {
    postgres = migratedPostgres().catch((error) => {
      postgres = undefined;
      throw error;
    });
    return postgres;
  }
  const client = await postgres;
  await emptyWrittenTables(client);
  return client;
}

let filledTablesQuery: string | undefined;

async function emptyWrittenTables(client: import('@electric-sql/pglite').PGlite): Promise<void> {
  if (!filledTablesQuery) {
    const tables = await client.query<{ name: string }>(
      "SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public'"
    );
    filledTablesQuery = tables.rows
      .map(({ name }) => `SELECT '"${name}"' AS name WHERE EXISTS (SELECT 1 FROM "${name}")`)
      .join(' UNION ALL ');
  }
  const filled = await client.query<{ name: string }>(filledTablesQuery);
  if (filled.rows.length > 0) {
    const deletes = filled.rows.map((row) => `DELETE FROM ${row.name};`).join(' ');
    await client.exec('SET session_replication_role = replica');
    try {
      await client.exec(deletes);
    } finally {
      await client.exec('SET session_replication_role = DEFAULT');
    }
  }
  const used = await client.query<{ name: string }>(
    "SELECT format('%I.%I', schemaname, sequencename) AS name FROM pg_sequences WHERE schemaname = 'public' AND last_value IS NOT NULL"
  );
  for (const { name } of used.rows) await client.exec(`ALTER SEQUENCE ${name} RESTART`);
}

async function createPostgresTestApp(seedUser: Partial<TestUser>): Promise<TestApp> {
  const client = await openPostgresTestDatabase();
  const schema = await import('../db/schema');
  const { appContext } = await import('../app-context');
  const { app } = await import('../app');
  const { assignServerRole, syncBuiltInRoles } = await import('../permissions/grants');
  const db = appContext().asyncDb;
  await syncBuiltInRoles(db);

  const id = seedUser.id ?? `test-user-${++counter}`;
  const email = seedUser.email ?? `test${counter}@example.com`;
  const displayName = seedUser.displayName ?? 'Test User';
  await db.insert(schema.users).values({ id, email, displayName });
  await assignServerRole(db, id, 'member');
  await db
    .insert(schema.serverSettings)
    .values({ id: 1, signupMode: 'open' })
    .onConflictDoNothing();

  const session = await appContext().lucia.createSession(id, {});
  const sessionCookie = appContext().lucia.createSessionCookie(session.id);
  const cookie = `${sessionCookie.name}=${sessionCookie.value}`;
  return {
    app,
    user: { id, email, displayName },
    sqlite: NO_RAW_SQLITE,
    sql: pgliteTestSql(client),
    cookie,
    authed: (method, path, body) => sendRequest(app, method, path, body, cookie),
    anon: (method, path, body) => sendRequest(app, method, path, body),
    close: () => {},
  };
}

export async function createTestApp(seedUser: Partial<TestUser> = {}): Promise<TestApp> {
  (await import('../middleware/rate-limit')).clearRateLimits();
  if (ON_POSTGRES) return createPostgresTestApp(seedUser);
  const { getDb, runMigrations } = await import('../db/connection');
  const db = getDb();
  const schema = await import('../db/schema');
  const { appContext } = await import('../app-context');
  const { app } = await import('../app');
  const { assignServerRole, syncBuiltInRoles } = await import('../permissions/grants');

  const sqlite = (db as unknown as { $client: import('bun:sqlite').Database }).$client;

  if (!migrated) {
    await runMigrations();
    migrated = true;
  } else {
    resetAllTables(sqlite);
    await syncBuiltInRoles(appContext().asyncDb);
  }

  const id = seedUser.id ?? `test-user-${++counter}`;
  const email = seedUser.email ?? `test${counter}@example.com`;
  const displayName = seedUser.displayName ?? 'Test User';
  await db.insert(schema.users).values({ id, email, displayName });
  await assignServerRole(appContext().asyncDb, id, 'member');
  db.insert(schema.serverSettings)
    .values({ id: 1, signupMode: 'open' })
    .onConflictDoNothing()
    .run();

  const session = await appContext().lucia.createSession(id, {});
  const sessionCookie = appContext().lucia.createSessionCookie(session.id);
  const cookie = `${sessionCookie.name}=${sessionCookie.value}`;

  return {
    app,
    user: { id, email, displayName },
    sqlite,
    sql: sqliteTestSql(sqlite),
    cookie,
    authed: (method, path, body) => sendRequest(app, method, path, body, cookie),
    anon: (method, path, body) => sendRequest(app, method, path, body),
    close: () => {},
  };
}

async function sendRequest(
  app: Hono,
  method: string,
  path: string,
  body: unknown,
  cookie?: string
): Promise<Response> {
  const headers: Record<string, string> = { 'Sec-Fetch-Site': 'same-origin' };
  if (cookie) headers.Cookie = cookie;
  if (body === undefined) return app.request(path, { method, headers });
  headers['Content-Type'] = 'application/json';
  return app.request(path, { method, headers, body: JSON.stringify(body) });
}

export type RequestFn = (method: string, path: string, body?: unknown) => Promise<Response>;

export async function requestAs(
  ctx: TestApp,
  userId: string
): Promise<{ cookie: string; request: RequestFn }> {
  const { appContext } = await import('../app-context');
  const sessionCookie = appContext().lucia.createSessionCookie(
    (await appContext().lucia.createSession(userId, {})).id
  );
  const cookie = `${sessionCookie.name}=${sessionCookie.value}`;
  return {
    cookie,
    request: (method, path, body) => sendRequest(ctx.app, method, path, body, cookie),
  };
}

function resetAllTables(sqlite: import('bun:sqlite').Database): void {
  const rows = sqlite
    .query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '__drizzle_migrations'"
    )
    .all() as { name: string }[];
  sqlite.run('PRAGMA foreign_keys = OFF');
  for (const { name } of rows) {
    sqlite.run(`DELETE FROM "${name}"`);
  }
  sqlite.run('PRAGMA foreign_keys = ON');
}
