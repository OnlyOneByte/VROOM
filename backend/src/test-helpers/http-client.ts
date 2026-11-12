import type { Hono } from 'hono';

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

let counter = 0;
let migrated = false;

export async function createTestApp(seedUser: Partial<TestUser> = {}): Promise<TestApp> {
  const { db, runMigrations } = await import('../db/connection');
  const schema = await import('../db/schema');
  const { lucia } = await import('../api/auth/lucia');
  const { app } = await import('../app');

  const sqlite = (db as unknown as { $client: import('bun:sqlite').Database }).$client;

  if (!migrated) {
    await runMigrations();
    migrated = true;
  } else {
    resetAllTables(sqlite);
  }

  const id = seedUser.id ?? `test-user-${++counter}`;
  const email = seedUser.email ?? `test${counter}@example.com`;
  const displayName = seedUser.displayName ?? 'Test User';
  await db.insert(schema.users).values({ id, email, displayName });

  const session = await lucia.createSession(id, {});
  const sessionCookie = lucia.createSessionCookie(session.id);
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
  const { lucia } = await import('../api/auth/lucia');
  const sessionCookie = lucia.createSessionCookie((await lucia.createSession(userId, {})).id);
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
