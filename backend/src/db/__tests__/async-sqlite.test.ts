import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { openAsyncDatabase, TransactionEndedError } from '../async-sqlite';
import * as schema from '../schema';
import { applyMigrationsUpTo, loadMigrations } from './migration-helpers';

const { users } = schema;
const migrations = loadMigrations();

function setup() {
  const sqlite = new Database(':memory:');
  sqlite.run('PRAGMA foreign_keys = ON');
  applyMigrationsUpTo(sqlite, migrations, migrations.length - 1);
  return { sqlite, ...openAsyncDatabase(sqlite) };
}

const user = (id: string) => ({ id, email: `${id}@test.com`, displayName: id });
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

function gate() {
  let open: () => void = () => undefined;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
}

describe('async transactions over bun:sqlite', () => {
  test('writes on both sides of an await commit together', async () => {
    const { db, transaction } = setup();
    await transaction(async (tx) => {
      await tx.insert(users).values(user('a'));
      await tick();
      await tx.insert(users).values(user('b'));
    });
    expect((await db.select({ id: users.id }).from(users)).map((r) => r.id).sort()).toEqual([
      'a',
      'b',
    ]);
  });

  test('a throw after an awaited write rolls the whole transaction back', async () => {
    const { db, transaction } = setup();
    await expect(
      transaction(async (tx) => {
        await tx.insert(users).values(user('a'));
        await tick();
        throw new Error('stop');
      })
    ).rejects.toThrow('stop');
    expect(await db.select().from(users)).toEqual([]);
  });

  test('a query from outside waits for the open transaction and never sees its uncommitted writes', async () => {
    const { db, transaction } = setup();
    const hold = gate();
    const inserted = gate();
    const tx = transaction(async (t) => {
      await t.insert(users).values(user('a'));
      inserted.open();
      await hold.opened;
      throw new Error('roll back');
    });
    await inserted.opened;
    let outsideDone = false;
    const outside = db
      .select()
      .from(users)
      .then((rows) => {
        outsideDone = true;
        return rows;
      });
    await tick();
    expect(outsideDone).toBe(false);
    hold.open();
    await expect(tx).rejects.toThrow('roll back');
    expect(await outside).toEqual([]);
  });

  test('two transactions run one after the other, never interleaved', async () => {
    const { transaction } = setup();
    const steps: string[] = [];
    const run = (name: string) =>
      transaction(async (tx) => {
        steps.push(`${name} start`);
        await tx.insert(users).values(user(name));
        await tick();
        steps.push(`${name} end`);
      });
    await Promise.all([run('a'), run('b')]);
    expect(steps).toEqual(['a start', 'a end', 'b start', 'b end']);
  });

  test('the outer database handle used inside the transaction joins it instead of deadlocking', async () => {
    const { db, transaction } = setup();
    await expect(
      transaction(async (tx) => {
        await tx.insert(users).values(user('a'));
        expect(await db.select().from(users).where(eq(users.id, 'a'))).toHaveLength(1);
        throw new Error('undo');
      })
    ).rejects.toThrow('undo');
    expect(await db.select().from(users)).toEqual([]);
  });

  test('a transaction started inside a transaction joins it through a savepoint', async () => {
    const { db, transaction } = setup();
    await transaction(async (tx) => {
      await tx.insert(users).values(user('a'));
      await transaction(async (inner) => {
        await inner.insert(users).values(user('b'));
      });
    });
    expect((await db.select({ id: users.id }).from(users)).map((r) => r.id).sort()).toEqual([
      'a',
      'b',
    ]);
  });

  test('nested transactions running at once take turns, so a failed one only undoes its own writes', async () => {
    const { db, transaction } = setup();
    await transaction(async () => {
      const results = await Promise.allSettled([
        transaction(async (tx) => {
          await tx.insert(users).values(user('x1'));
          await tick();
          throw new Error('x fails');
        }),
        transaction(async (tx) => {
          await tx.insert(users).values(user('y1'));
          await tick();
          await tx.insert(users).values(user('y2'));
        }),
      ]);
      expect(results.map((r) => r.status)).toEqual(['rejected', 'fulfilled']);
    });
    expect((await db.select({ id: users.id }).from(users)).map((r) => r.id).sort()).toEqual([
      'y1',
      'y2',
    ]);
  });

  test("the parent's own writes wait while a nested transaction is open", async () => {
    const { db, transaction } = setup();
    await transaction(async (tx) => {
      await Promise.all([
        transaction(async (inner) => {
          await inner.insert(users).values(user('inner'));
          await tick();
          throw new Error('inner fails');
        }).catch(() => undefined),
        tx.insert(users).values(user('parent')),
      ]);
    });
    expect((await db.select({ id: users.id }).from(users)).map((r) => r.id)).toEqual(['parent']);
  });

  test('work started with outsideTransaction keeps running after the transaction ends', async () => {
    const { db, transaction, outsideTransaction } = setup();
    let later: Promise<unknown> = Promise.resolve();
    await transaction(async (tx) => {
      await tx.insert(users).values(user('a'));
      later = outsideTransaction(() => tick().then(() => db.insert(users).values(user('b'))));
    });
    await later;
    expect((await db.select({ id: users.id }).from(users)).map((r) => r.id).sort()).toEqual([
      'a',
      'b',
    ]);
  });

  test('a nested transaction that only starts after its root committed is refused', async () => {
    const { db, transaction } = setup();
    let queued: Promise<unknown> = Promise.resolve();
    await transaction(async () => {
      const first = transaction(async (tx) => {
        await tick();
        await tx.insert(users).values(user('first'));
      });
      queued = transaction(async (tx) => {
        await tx.insert(users).values(user('late'));
      });
      await first;
    });
    const error = (await queued.catch((e) => e)) as { cause?: unknown };
    expect(
      error instanceof TransactionEndedError || error.cause instanceof TransactionEndedError
    ).toBe(true);
    expect((await db.select({ id: users.id }).from(users)).map((r) => r.id)).toEqual(['first']);
  });

  test('a failed batch inside a transaction leaves none of its rows', async () => {
    const { db, transaction } = setup();
    await transaction(async (tx) => {
      await tx.insert(users).values(user('kept'));
      await expect(
        db.batch([db.insert(users).values(user('a')), db.insert(users).values(user('a'))])
      ).rejects.toThrow();
    });
    expect((await db.select({ id: users.id }).from(users)).map((r) => r.id)).toEqual(['kept']);
  });

  test('a lazy query handed to outsideTransaction never sees the uncommitted rows', async () => {
    const { db, transaction, outsideTransaction } = setup();
    let seen: Promise<unknown> = Promise.resolve();
    await expect(
      transaction(async (tx) => {
        await tx.insert(users).values(user('a'));
        seen = outsideTransaction(() => db.select({ id: users.id }).from(users)).then((r) => r);
        throw new Error('roll back');
      })
    ).rejects.toThrow('roll back');
    expect(await seen).toEqual([]);
  });

  test('a batch outside a transaction is atomic', async () => {
    const { db } = setup();
    await expect(
      db.batch([db.insert(users).values(user('a')), db.insert(users).values(user('a'))])
    ).rejects.toThrow();
    expect(await db.select().from(users)).toEqual([]);
  });

  test('db.transaction on the returned handle is the gated transaction', async () => {
    const { db } = setup();
    const hold = gate();
    const inserted = gate();
    const tx = db.transaction(async (t) => {
      await t.insert(users).values(user('a'));
      inserted.open();
      await hold.opened;
      throw new Error('roll back');
    });
    await inserted.opened;
    const outside = db.select().from(users);
    hold.open();
    await expect(tx).rejects.toThrow('roll back');
    expect(await outside).toEqual([]);
  });

  test('a write that outlives its transaction is refused, not committed on its own', async () => {
    const { db, transaction } = setup();
    let late: Promise<unknown> = Promise.resolve();
    await expect(
      transaction(async (tx) => {
        late = tick().then(() => tx.insert(users).values(user('late')));
        throw new Error('fail fast');
      })
    ).rejects.toThrow('fail fast');
    const error = (await late.catch((e) => e)) as { cause?: unknown };
    expect(error.cause).toBeInstanceOf(TransactionEndedError);
    expect(await db.select().from(users)).toEqual([]);
  });

  test('run reports changes, and batch runs its statements in order', async () => {
    const { db } = setup();
    const result = (await db.insert(users).values(user('a')).run()) as unknown as {
      changes: number;
    };
    expect(result.changes).toBe(1);
    await db.batch([
      db.insert(users).values(user('b')),
      db.update(users).set({ displayName: 'B' }).where(eq(users.id, 'b')),
    ]);
    expect((await db.select().from(users).where(eq(users.id, 'b')))[0]?.displayName).toBe('B');
  });

  test('rows map exactly as the bun:sqlite driver maps them', async () => {
    const { sqlite, db } = setup();
    await db.insert(users).values(user('a'));
    const sync = drizzle(sqlite, { schema });
    expect(await db.select().from(users)).toEqual(sync.select().from(users).all());
    expect(await db.query.users.findFirst()).toEqual(sync.query.users.findFirst().sync());
  });
});
