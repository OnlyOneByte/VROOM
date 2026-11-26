import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { openAsyncDatabase } from '../async-sqlite';
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
  let open = () => undefined as void;
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

  test('rows map exactly as the bun:sqlite driver maps them', async () => {
    const { sqlite, db } = setup();
    await db.insert(users).values(user('a'));
    const sync = drizzle(sqlite, { schema });
    expect(await db.select().from(users)).toEqual(sync.select().from(users).all());
    expect(await db.query.users.findFirst()).toEqual(sync.query.users.findFirst().sync());
  });
});
