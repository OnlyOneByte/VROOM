import { afterEach, beforeEach } from 'bun:test';
import type { Hono } from 'hono';

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

export async function createTestApp(seedUser: Partial<TestUser> = {}): Promise<TestApp> {
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
