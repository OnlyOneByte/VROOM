import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { count, eq, sql } from 'drizzle-orm';
import { drizzle as pgliteDrizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { DEMO_USER_ID } from '../../api/auth/demo-account';
import { createLucia } from '../../api/auth/lucia';
import { DEMO_SESSION_PREFIX } from '../../api/auth/utils';
import { CONFIG } from '../../config';
import { LATE_QUERY, takeTransactionViolations } from '../../test-helpers/transaction-guard';
import {
  type AsyncPgDatabase,
  bunSqlConnection,
  openAsyncPostgres,
  pgliteConnection,
} from '../async-postgres';
import {
  inAsyncTransaction,
  RawTransactionControlError,
  TransactionEndedError,
} from '../async-sqlite';
import { roles, sessions, users } from '../pg/schema';

const MIGRATIONS = join(import.meta.dir, '../../../drizzle-pg');

let client: PGlite;
let session: ReturnType<typeof openAsyncPostgres>;
let db: AsyncPgDatabase;

beforeEach(async () => {
  client = new PGlite();
  await migrate(pgliteDrizzle(client), { migrationsFolder: MIGRATIONS });
  session = openAsyncPostgres(pgliteConnection(client));
  db = session.db;
});

afterEach(async () => {
  await client.close();
});

const user = (id: string) => ({ id, email: `${id}@x.test`, displayName: id });
const ids = async () =>
  (await db.select({ id: users.id }).from(users).orderBy(users.id)).map((r) => String(r.id));
const causeOf = (error: unknown) => (error as { cause?: unknown }).cause ?? error;

describe('the async Postgres session', () => {
  test('reads and writes through drizzle, with returning', async () => {
    const [row] = await db.insert(users).values(user('a')).returning({ id: users.id });
    expect(row).toEqual({ id: 'a' });
    await db.update(users).set({ displayName: 'Ann' }).where(eq(users.id, 'a'));
    const [read] = await db.select().from(users).where(eq(users.id, 'a'));
    expect(read?.displayName).toBe('Ann');
    expect(read?.createdAt).toBeInstanceOf(Date);
  });

  test('a transaction commits, and an error inside it rolls everything back', async () => {
    await session.transaction(async (tx) => {
      await tx.insert(users).values(user('a'));
    });
    await expect(
      session.transaction(async (tx) => {
        await tx.insert(users).values(user('b'));
        throw new Error('stop');
      })
    ).rejects.toThrow('stop');
    expect(await ids()).toEqual(['a']);
  });

  test('a failed nested transaction rolls back only itself', async () => {
    await session.transaction(async (tx) => {
      await tx.insert(users).values(user('a'));
      await expect(
        session.transaction(async (inner) => {
          await inner.insert(users).values(user('b'));
          throw new Error('inner');
        })
      ).rejects.toThrow('inner');
      await tx.insert(users).values(user('c'));
    });
    expect(await ids()).toEqual(['a', 'c']);
  });

  test('a failed statement caught inside a transaction leaves the transaction usable, as on SQLite', async () => {
    await session.transaction(async (tx) => {
      await tx.insert(users).values(user('a'));
      const duplicate = await tx
        .insert(users)
        .values(user('a'))
        .catch((e: unknown) => e);
      expect(String(causeOf(duplicate))).toContain('duplicate key');
      await tx.insert(users).values(user('b'));
    });
    expect(await ids()).toEqual(['a', 'b']);
  });

  test('transactions run one at a time, so a check-then-write cannot race', async () => {
    const claim = (id: string) =>
      session.transaction(async (tx) => {
        const [{ n } = { n: 0 }] = await tx.select({ n: count() }).from(users);
        await new Promise((resolve) => setTimeout(resolve, 5));
        if (n === 0) await tx.insert(users).values(user(id));
      });
    await Promise.all([claim('a'), claim('b'), claim('c')]);
    expect(await ids()).toHaveLength(1);
  });

  test('a query outside a transaction waits for it rather than running inside it', async () => {
    let outside: Promise<string[]> = Promise.resolve([]);
    await expect(
      session.transaction(async (tx) => {
        await tx.insert(users).values(user('a'));
        outside = session.outsideTransaction(ids);
        throw new Error('roll back');
      })
    ).rejects.toThrow('roll back');
    expect(await outside).toEqual([]);
  });

  test('outsideTransaction work started inside survives the rollback and is not in a transaction', async () => {
    let detached: Promise<boolean> = Promise.resolve(true);
    await expect(
      session.transaction(async () => {
        expect(inAsyncTransaction()).toBe(true);
        detached = session.outsideTransaction(async () => {
          await db.insert(users).values(user('kept'));
          return inAsyncTransaction();
        });
        throw new Error('roll back');
      })
    ).rejects.toThrow('roll back');
    expect(await detached).toBe(false);
    expect(await ids()).toEqual(['kept']);
  });

  test('a query left running after its transaction ended is refused and reported', async () => {
    let late: Promise<unknown> = Promise.resolve();
    await session.transaction(async (tx) => {
      await tx.insert(users).values(user('a'));
      late = Promise.resolve().then(() => tx.insert(users).values(user('late')));
    });
    expect(causeOf(await late.catch((e: unknown) => e))).toBeInstanceOf(TransactionEndedError);
    expect(await ids()).toEqual(['a']);
    expect(takeTransactionViolations()).toEqual([LATE_QUERY]);
  });

  test('raw transaction control is refused', async () => {
    for (const statement of ['BEGIN', 'COMMIT', 'START TRANSACTION', 'SAVEPOINT x', 'ROLLBACK']) {
      const error = await db.execute(sql.raw(statement)).catch((e: unknown) => e);
      expect(causeOf(error), statement).toBeInstanceOf(RawTransactionControlError);
    }
  });

  test('a deferred transaction reads one snapshot; a write transaction uses read committed', async () => {
    const level = async (behavior?: 'deferred') =>
      session.transaction(
        async (tx) =>
          (
            (await tx.execute(sql`SHOW transaction_isolation`)) as unknown as {
              transaction_isolation: string;
            }[]
          )[0] ?? { transaction_isolation: 'none' },
        behavior ? { behavior } : {}
      );
    expect((await level('deferred')).transaction_isolation).toBe('repeatable read');
    expect((await level()).transaction_isolation).toBe('read committed');
  });

  test('roles seeded by the migration are readable through the session', async () => {
    await db.insert(roles).values({ id: 'r1', scope: 'server', name: 'R', builtIn: false });
    expect((await db.select({ id: roles.id }).from(roles)).map((r) => r.id)).toContain('r1');
  });
});

describe('the Bun.sql connection', () => {
  test('sends array-mode queries through values() and the rest as row objects', async () => {
    const calls: string[] = [];
    const reserved = {
      unsafe(text: string, params: unknown[]) {
        calls.push(`${text} ${JSON.stringify(params)}`);
        const rows = Promise.resolve([{ id: 'a' }]);
        return Object.assign(rows, { values: () => Promise.resolve([['a']]) });
      },
    };
    const connection = bunSqlConnection(reserved);
    expect(await connection.query('select $1', [1], 'array')).toEqual([['a']]);
    expect(await connection.query('select $1', [2], 'object')).toEqual([{ id: 'a' }]);
    expect(calls).toEqual(['select $1 [1]', 'select $1 [2]']);
  });
});

describe('Lucia sessions on Postgres', () => {
  test('a session is created, validated and invalidated; a demo session is capped and expires', async () => {
    await db.insert(users).values([user('u'), { ...user(DEMO_USER_ID), id: DEMO_USER_ID }]);
    const lucia = createLucia(db, 'pg');
    const created = await lucia.createSession('u', {});
    const { session: valid, user: owner } = await lucia.validateSession(created.id);
    expect(valid?.userId).toBe('u');
    expect(owner?.email).toBe('u@x.test');
    expect(valid?.expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * 24 * 3600 * 1000);
    await lucia.invalidateSession(created.id);
    expect((await lucia.validateSession(created.id)).session).toBeNull();
    await lucia.deleteExpiredSessions();

    const issued = Date.now();
    const demo = await lucia.createSession(
      DEMO_USER_ID,
      {},
      { sessionId: `${DEMO_SESSION_PREFIX}${issued}_a` }
    );
    const [stored] = await db.select().from(sessions).where(eq(sessions.id, demo.id));
    expect(Number(stored?.expiresAt)).toBe(
      Math.floor((issued + CONFIG.demo.sessionDuration) / 1000)
    );
    const stale = `${DEMO_SESSION_PREFIX}${issued - CONFIG.demo.sessionDuration - 1000}_b`;
    await lucia.createSession(DEMO_USER_ID, {}, { sessionId: stale });
    expect((await lucia.validateSession(stale)).session).toBeNull();
    expect(await db.select().from(sessions).where(eq(sessions.id, stale))).toEqual([]);
  });
});
