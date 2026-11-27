import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { generateDrizzleJson, generateMigration } from 'drizzle-kit/api';
import { getTableColumns, getTableName, is, sql } from 'drizzle-orm';
import { drizzle as sqliteDrizzle } from 'drizzle-orm/bun-sqlite';
import { migrate as sqliteMigrate } from 'drizzle-orm/bun-sqlite/migrator';
import { boolean, getTableConfig, index, PgTable, pgTable, text } from 'drizzle-orm/pg-core';
import { drizzle as pgDrizzle } from 'drizzle-orm/pglite';
import { migrate as pgMigrate } from 'drizzle-orm/pglite/migrator';
import * as pg from '../pg/schema';
import * as sqlite from '../schema';

const BACKEND = join(import.meta.dir, '../../..');
const PG_MIGRATIONS = join(BACKEND, 'drizzle-pg');
const SQLITE_MIGRATIONS = join(BACKEND, 'drizzle');

const pgExports = pg as unknown as Record<string, unknown>;
const pgTables = Object.values(pgExports).filter((value): value is PgTable => is(value, PgTable));

function latestSnapshot(): Parameters<typeof generateMigration>[0] {
  const journal = JSON.parse(readFileSync(join(PG_MIGRATIONS, 'meta/_journal.json'), 'utf-8')) as {
    entries: { idx: number }[];
  };
  const last = journal.entries.at(-1);
  if (!last) throw new Error('The Postgres migration journal is empty');
  const file = `${String(last.idx).padStart(4, '0')}_snapshot.json`;
  return JSON.parse(readFileSync(join(PG_MIGRATIONS, 'meta', file), 'utf-8'));
}

async function applyEach(statements: string[]): Promise<string[]> {
  const db = new PGlite();
  const failed: string[] = [];
  try {
    for (const statement of statements) {
      await db
        .exec(statement)
        .catch((error) => failed.push(`${statement.slice(0, 120)}: ${error}`));
    }
  } finally {
    await db.close();
  }
  return failed;
}

async function ddlFor(tables: Record<string, unknown>): Promise<string[]> {
  return generateMigration(generateDrizzleJson({}), generateDrizzleJson(tables));
}

type Insertable = { insert(table: unknown): { values(row: unknown): Promise<unknown> } };
type Tables = typeof sqlite;

async function attempts(db: Insertable, table: unknown, rows: unknown[]): Promise<boolean[]> {
  const out: boolean[] = [];
  for (const row of rows) {
    out.push(
      await db
        .insert(table)
        .values(row)
        .then(
          () => true,
          () => false
        )
    );
  }
  return out;
}

const OVERRIDE_CASES: Record<string, (db: Insertable, t: Tables) => Promise<boolean[]>> = {
  vf_active_vehicle_idx: async (db, t) => {
    await db.insert(t.users).values({ id: 'u', email: 'u@x.test', displayName: 'U' });
    await db
      .insert(t.vehicles)
      .values({ id: 'v', userId: 'u', make: 'Kia', model: 'Rio', year: 2020 });
    const loan = (id: string, isActive: boolean) => ({
      id,
      vehicleId: 'v',
      provider: 'Bank',
      originalAmount: 1000,
      termMonths: 12,
      startDate: new Date('2024-01-01T00:00:00Z'),
      paymentAmount: 100,
      isActive,
    });
    return attempts(db, t.vehicleFinancing, [
      loan('a', true),
      loan('b', false),
      loan('c', false),
      loan('d', true),
    ]);
  },
};

describe('the Postgres baseline migration', () => {
  test('is up to date with the Postgres schema', async () => {
    const pending = await generateMigration(latestSnapshot(), generateDrizzleJson(pgExports));
    expect(pending, 'Run `bun run db:generate:pg` and commit drizzle-pg/:').toEqual([]);
  });

  test('the schema as written applies to Postgres, before any migration is generated', async () => {
    const statements = await ddlFor(pgExports);
    expect(statements.length).toBeGreaterThan(100);
    expect(await applyEach(statements)).toEqual([]);
  });

  test('a SQLite-style boolean comparison in an index condition fails that check', async () => {
    const probe = pgTable('probe', { id: text('id').primaryKey(), flag: boolean('flag') }, (t) => [
      index('probe_flag_idx').on(t.id).where(sql`${t.flag} = 0`),
    ]);
    const failed = await applyEach(await ddlFor({ probe }));
    expect(failed.join('\n')).toContain('boolean = integer');
  });

  test('applies on a fresh database and creates every table, column and index', async () => {
    const client = new PGlite();
    try {
      await pgMigrate(pgDrizzle(client), { migrationsFolder: PG_MIGRATIONS });
      const columns = await client.query<{ t: string; c: string; nullable: string }>(
        "SELECT table_name AS t, column_name AS c, is_nullable AS nullable FROM information_schema.columns WHERE table_schema = 'public'"
      );
      const indexes = await client.query<{ name: string }>(
        "SELECT indexname AS name FROM pg_indexes WHERE schemaname = 'public'"
      );
      const live = new Set(columns.rows.map((r) => `${r.t}.${r.c} ${r.nullable}`));
      const want = pgTables.flatMap((table) =>
        Object.values(getTableColumns(table)).map(
          (c) => `${getTableName(table)}.${c.name} ${c.notNull ? 'NO' : 'YES'}`
        )
      );
      expect(want.filter((w) => !live.has(w))).toEqual([]);
      expect(live.size).toBe(want.length);
      const liveIndexes = new Set(indexes.rows.map((r) => r.name));
      const wantIndexes = pgTables.flatMap((t) =>
        getTableConfig(t).indexes.map((i) => i.config.name)
      );
      expect(wantIndexes.filter((name) => !liveIndexes.has(String(name)))).toEqual([]);
    } finally {
      await client.close();
    }
  });
});

describe('each hand-written Postgres index condition means what the SQLite one does', () => {
  test('every override has a case', () => {
    expect(Object.keys(pg.PG_INDEX_WHERE).filter((name) => !(name in OVERRIDE_CASES))).toEqual([]);
  });

  for (const [name, run] of Object.entries(OVERRIDE_CASES)) {
    test(`${name} accepts and refuses the same rows on both databases`, async () => {
      const lite = new Database(':memory:');
      const client = new PGlite();
      try {
        const liteDb = sqliteDrizzle(lite);
        sqliteMigrate(liteDb, { migrationsFolder: SQLITE_MIGRATIONS });
        const pgDb = pgDrizzle(client);
        for (const statement of await ddlFor(pgExports)) await client.exec(statement);
        const onSqlite = await run(liteDb as unknown as Insertable, sqlite);
        const onPostgres = await run(pgDb as unknown as Insertable, pg as unknown as Tables);
        expect(onPostgres).toEqual(onSqlite);
        expect(onSqlite).toContain(false);
        expect(onSqlite).toContain(true);
      } finally {
        lite.close();
        await client.close();
      }
    });
  }
});
