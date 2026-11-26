import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import {
  openAsyncDatabase,
  RawTransactionControlError,
  SyncQueryInAsyncTransactionError,
  TransactionEndedError,
  TransactionRolledBackError,
} from '../async-sqlite';
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

  test('when SQLite rolls the transaction back itself, the original error reaches the caller', async () => {
    const { db, transaction } = setup();
    await db.insert(users).values(user('dup'));
    const error = await transaction(async (tx) => {
      await tx.insert(users).values(user('t1'));
      await tx.run(
        sql`insert or rollback into users (id, email, display_name) values ('dup', 'x@test.com', 'x')`
      );
    }).then(
      () => new Error('resolved') as Error & { cause?: Error },
      (e) => e as Error & { cause?: Error }
    );
    expect(String(error.cause ?? error)).toMatch(/UNIQUE constraint failed/);
    expect((await db.select({ id: users.id }).from(users)).map((r) => r.id)).toEqual(['dup']);
  });

  test('after SQLite rolls the transaction back, later writes are refused, not committed one by one', async () => {
    const { db, transaction } = setup();
    await db.insert(users).values(user('dup'));
    const error = await transaction(async (tx) => {
      await tx.insert(users).values(user('t1'));
      await tx
        .run(
          sql`insert or rollback into users (id, email, display_name) values ('dup', 'x@test.com', 'x')`
        )
        .catch(() => undefined);
      await tx.insert(users).values(user('t2'));
      await transaction(async (inner) => {
        await inner.insert(users).values(user('t3'));
      });
    }).then(
      () => new Error('resolved') as Error & { cause?: unknown },
      (e) => e as Error & { cause?: unknown }
    );
    expect(
      error instanceof TransactionRolledBackError ||
        error.cause instanceof TransactionRolledBackError
    ).toBe(true);
    expect((await db.select({ id: users.id }).from(users)).map((r) => r.id)).toEqual(['dup']);
  });

  test('a sync query on the same connection during an open async transaction is refused', async () => {
    const { sqlite, transaction } = setup();
    const sync = drizzle(sqlite, { schema });
    sync.insert(users).values(user('before')).run();
    await expect(
      transaction(async (tx) => {
        await tx.insert(users).values(user('a'));
        sync.select().from(users).all();
      })
    ).rejects.toBeInstanceOf(SyncQueryInAsyncTransactionError);
    expect(sync.select({ id: users.id }).from(users).all()).toEqual([{ id: 'before' }]);
  });

  test('raw BEGIN, COMMIT, ROLLBACK or SAVEPOINT inside a transaction is refused and nothing commits', async () => {
    const { db, transaction } = setup();
    const raws = [
      sql`commit`,
      sql`end`,
      sql`begin`,
      sql`rollback`,
      sql`savepoint sp9`,
      sql`release sp0`,
    ];
    for (const raw of raws) {
      const error = await transaction(async (tx) => {
        await tx.insert(users).values(user('a'));
        await tx.run(raw);
        await tx.insert(users).values(user('b'));
      }).then(
        () => null,
        (e) => e as { cause?: unknown }
      );
      expect(error?.cause ?? error).toBeInstanceOf(RawTransactionControlError);
      expect(await db.select().from(users)).toEqual([]);
    }
  });

  test('raw transaction control outside any transaction is refused too', async () => {
    const { sqlite, db } = setup();
    for (const raw of [sql`begin`, sql`commit`, sql`end`]) {
      expect(() => db.run(raw)).toThrow(RawTransactionControlError);
      expect(sqlite.inTransaction).toBe(false);
    }
  });

  test('an un-awaited raw COMMIT is refused the moment it is called, so nothing commits early', async () => {
    const { db, transaction } = setup();
    await expect(
      transaction(async (tx) => {
        await tx.insert(users).values(user('a'));
        await transaction(async (inner) => {
          expect(() => inner.run(sql`commit`)).toThrow(RawTransactionControlError);
          expect(() => inner.all(sql`end`)).toThrow(RawTransactionControlError);
        });
        expect(() => tx.get(sql`commit`)).toThrow(RawTransactionControlError);
        throw new Error('root fails');
      })
    ).rejects.toThrow('root fails');
    expect(await db.select().from(users)).toEqual([]);
  });

  test('connection upkeep still runs while an async transaction is open', async () => {
    const { transaction, upkeep } = setup();
    await transaction(async (tx) => {
      await tx.insert(users).values(user('a'));
      expect(upkeep('health')).toEqual({ health: 1 });
    });
  });

  test('the same connection always gets the same async database', () => {
    const sqlite = new Database(':memory:');
    expect(openAsyncDatabase(sqlite)).toBe(openAsyncDatabase(sqlite));
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
