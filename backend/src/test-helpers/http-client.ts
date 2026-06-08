/**
 * In-process HTTP test client for VROOM's backend.
 *
 * Spins up the REAL Hono app against a throwaway SQLite DB and drives it via
 * `app.request()` — no network, no port. This exercises the full route stack
 * (middleware → auth → zValidator → route handler → repository → DB), which is
 * exactly the layer that repository-level unit tests bypass. The reminders
 * PUT-400 bug (route merges the existing row then re-validates with a schema
 * that rejected the row's NULLs) is the canonical example this harness catches.
 *
 * HOW IT WORKS — import ordering is load-bearing:
 *   The DB singleton in `db/connection.ts` reads `CONFIG.database.url` at IMPORT
 *   time, and `CONFIG` reads `process.env` at ITS import time. So this helper
 *   sets `DATABASE_URL`/`NODE_ENV` on `process.env` and then uses DYNAMIC
 *   `import()` for everything DB-bound. A test MUST call `createTestApp()`
 *   before statically importing anything that pulls in `config`/`connection`.
 *   (Keep this file's own imports type-only for the same reason.)
 *
 * Usage:
 *   import { createTestApp, type TestApp } from '../../../test-helpers/http-client';
 *   let ctx: TestApp;
 *   beforeEach(async () => { ctx = await createTestApp(); });
 *   afterEach(() => ctx.close());
 *   const res = await ctx.authed('GET', '/api/v1/reminders');
 */

import type { Hono } from 'hono';

/**
 * Read and JSON-parse a Response body as type `T`.
 *
 * `Response.json()` is correctly typed `Promise<unknown>` (the wire gives untyped
 * bytes), which would otherwise force an `as`-cast at every call site. This
 * centralizes that one cast so route tests read cleanly:
 *   `const body = await json<DataEnvelope<{ id: string }>>(res)`.
 * The caller declares the shape it asserts against — no `any`, no per-file casts.
 */
export async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** Standard success envelope returned by VROOM routes: `{ data: T }`. */
export interface DataEnvelope<T> {
  data: T;
}

/** Paginated list envelope: `{ data: T[]; pagination: { totalCount, ... } }`. */
export interface PaginatedEnvelope<T> {
  data: T[];
  pagination: { totalCount: number; limit: number; offset: number };
}

export interface TestUser {
  id: string;
  email: string;
  displayName: string;
}

export interface TestApp {
  /** The real Hono app, bound to the throwaway DB. */
  app: Hono;
  /** The seeded user this app's session belongs to. */
  user: TestUser;
  /** The raw sqlite handle (for direct seeding/inspection in tests). */
  sqlite: import('bun:sqlite').Database;
  /** `Cookie` header value carrying a valid Lucia session for `user`. */
  cookie: string;
  /** Issue an authenticated request (attaches the session cookie + JSON body). */
  authed: (
    method: string,
    path: string,
    body?: unknown
  ) => Promise<Response>;
  /** Issue an UNauthenticated request (no cookie) — for 401 assertions. */
  anon: (method: string, path: string, body?: unknown) => Promise<Response>;
  /** Close the in-memory DB. */
  close: () => void;
}

let counter = 0;
// The DB singleton is a CACHED module — every dynamic import() in this process
// returns the same in-memory DB. So we migrate ONCE, then reset DATA between
// calls (delete all rows) rather than recreating the DB. Tracks migration state.
let migrated = false;

/**
 * Build a fresh in-process app over a shared in-memory DB with a seeded user
 * and a valid session. Data is reset on every call, so tests are isolated even
 * though the underlying DB/module singletons are shared for the process.
 */
export async function createTestApp(
  seedUser: Partial<TestUser> = {}
): Promise<TestApp> {
  // 1) Point the (not-yet-imported) DB singleton at the in-memory DB and force a
  //    non-production env BEFORE any DB-bound module is imported.
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = ':memory:';
  process.env.SESSION_SECRET ||= 'test-session-secret-at-least-32-chars-long';
  // Deterministic encryption key so provider-credential decrypt() never throws.
  process.env.PROVIDER_ENCRYPTION_KEY ||= '0'.repeat(64);

  // 2) Dynamic-import DB-bound modules (now they bind to :memory:).
  const { db, runMigrations } = await import('../db/connection');
  const schema = await import('../db/schema');
  const { lucia } = await import('../api/auth/lucia');
  const { app } = await import('../app');

  const sqlite = (db as unknown as { $client: import('bun:sqlite').Database }).$client;

  // 3) Migrate once; thereafter just wipe all data for per-test isolation.
  if (!migrated) {
    await runMigrations();
    migrated = true;
  } else {
    resetAllTables(sqlite);
  }

  // 4) Seed the user this session belongs to.
  const id = seedUser.id ?? `test-user-${++counter}`;
  const email = seedUser.email ?? `test${counter}@example.com`;
  const displayName = seedUser.displayName ?? 'Test User';
  await db.insert(schema.users).values({ id, email, displayName });

  // 5) Mint a real Lucia session + cookie (full auth path, not a fake).
  const session = await lucia.createSession(id, {});
  const sessionCookie = lucia.createSessionCookie(session.id);
  const cookie = `${sessionCookie.name}=${sessionCookie.value}`;

  // `async` so the return type is always `Promise<Response>` — `app.request()` is
  // typed `Response | Promise<Response>`, and awaiting it collapses the union to
  // match the `TestApp.authed/anon` signature.
  const buildReq = async (
    method: string,
    path: string,
    body: unknown,
    withCookie: boolean
  ): Promise<Response> => {
    const headers: Record<string, string> = {};
    if (withCookie) headers.Cookie = cookie;
    // Real browsers send `Sec-Fetch-Site: same-origin` on same-origin requests, and
    // the app's csrf() middleware relies on it: a state-changing request (POST/PUT/
    // DELETE) with neither a JSON content-type NOR a verifiable Origin/Sec-Fetch-Site
    // is rejected with 403. A body-less POST (e.g. /reminders/trigger) has no
    // content-type, so without this header app.request() would 403 where a browser
    // succeeds. Setting it makes the harness faithfully mirror a same-origin call.
    headers['Sec-Fetch-Site'] = 'same-origin';
    let init: RequestInit = { method, headers };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init = { ...init, body: JSON.stringify(body), headers };
    }
    return app.request(path, init);
  };

  return {
    app,
    user: { id, email, displayName },
    sqlite,
    cookie,
    authed: (method, path, body) => buildReq(method, path, body, true),
    anon: (method, path, body) => buildReq(method, path, body, false),
    // No-op: the in-memory DB is a shared process singleton (module cache), so we
    // must NOT close it between tests — data is reset on the next createTestApp().
    close: () => {},
  };
}

/**
 * Wipe every row from every user table (FKs off during the wipe). Keeps the
 * shared in-memory DB but isolates each test's data. Order-independent because
 * foreign_keys is toggled off for the delete sweep.
 */
function resetAllTables(sqlite: import('bun:sqlite').Database): void {
  const rows = sqlite
    .query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '__drizzle_migrations'")
    .all() as { name: string }[];
  sqlite.run('PRAGMA foreign_keys = OFF');
  for (const { name } of rows) {
    sqlite.run(`DELETE FROM "${name}"`);
  }
  sqlite.run('PRAGMA foreign_keys = ON');
}
