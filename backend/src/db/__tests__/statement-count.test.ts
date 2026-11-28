import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { openAsyncPostgres, pgliteConnection } from '../async-postgres';
import { openAsyncDatabase } from '../async-sqlite';
import { countStatements } from '../statement-count';

describe('countStatements', () => {
  test('counts each SQLite statement once, cached or not, and skips transaction control', async () => {
    const { db } = openAsyncDatabase(new Database(':memory:'));
    await db.all(sql`select 1`);
    const { result, statements } = await countStatements(async () => {
      await db.all(sql`select 1`);
      await db.all(sql`select 1`);
      return db.transaction(async (tx) => tx.all(sql`select 2 as two`));
    });
    expect(statements).toBe(3);
    expect(result).toEqual([{ two: 2 }]);
  });

  test('counts each Postgres statement once and skips transaction control and savepoints', async () => {
    const client = new PGlite();
    try {
      const { db } = openAsyncPostgres(pgliteConnection(client));
      const { statements } = await countStatements(async () => {
        await db.execute(sql`select 1`);
        await db.transaction(async (tx) => {
          await tx.execute(sql`select 2`);
          await tx.transaction(async (inner) => inner.execute(sql`select 3`));
        });
      });
      expect(statements).toBe(3);
    } finally {
      await client.close();
    }
  });

  test('ignores statements run outside the counted call', async () => {
    const { db } = openAsyncDatabase(new Database(':memory:'));
    const { statements } = await countStatements(async () => undefined);
    await db.all(sql`select 1`);
    expect(statements).toBe(0);
  });
});
